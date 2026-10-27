// 宿命公牌 (Dora Hold'em) - 核心单局状态机与裁判逻辑

import {
  Card,
  Rank,
  createDeck,
  shuffleDeck,
  parseCard,
} from './card.js';
import {
  findBestHand,
  compare5CardHands,
  Evaluated5CardHand,
} from './evaluator.js';
import {
  TurnActionType,
  GameEndReason,
  PublicPlayerState,
  PrivatePlayerState,
  PublicGameState,
  HandSettlement,
  HandActionLogItem,
} from '../shared/types.js';

export interface PlayerInput {
  seat: number;
  userId: number;
  username: string;
}

export interface PlayerRuntimeState {
  seat: number;
  userId: number;
  username: string;
  holeCards: Card[];        // 所有的当前手牌（含暗置与明置换入牌）
  exposedCards: Card[];     // 通过公私置换得到的明置手牌（锁定不可再次换回公区）
  faceUpDiscards: Card[];   // 面前横置展示的明牌弃牌
  isFolded: boolean;
  foldOrbit?: number;
  isDealer: boolean;
  chipScore: number;
}

export class GameHandState {
  public readonly roomId: string;
  public readonly roundNumber: number;
  public readonly totalRounds: number;
  public readonly dealerSeat: number;
  public readonly playerCount: number;

  public currentOrbit: number = 1;
  public currentTurnSeat: number;
  public legalDoraRank: Rank;
  public initialDoraCard: Card;
  public communityCards: Card[] = [];
  public drawPile: Card[] = [];
  public discardPile: Card[] = [];
  public currentPot: number = 0;

  public players: Map<number, PlayerRuntimeState> = new Map();
  public actionLogs: HandActionLogItem[] = [];
  public isHandFinished: boolean = false;
  public endReason?: GameEndReason;
  public settlement?: HandSettlement;

  private stepCounter: number = 0;
  private hasOrbitAdvancedThisCycle: boolean = false;

  constructor(
    roomId: string,
    roundNumber: number,
    totalRounds: number,
    dealerSeat: number,
    playerInputs: PlayerInput[],
    initialScores: Record<number, number> = {}
  ) {
    this.roomId = roomId;
    this.roundNumber = roundNumber;
    this.totalRounds = totalRounds;
    this.dealerSeat = dealerSeat;
    this.currentTurnSeat = dealerSeat; // 庄家先行行动
    this.playerCount = playerInputs.length;

    // 洗牌与分发
    const deck = shuffleDeck(createDeck());

    // 每位玩家发 5 张暗置手牌
    for (const p of playerInputs) {
      const hole = deck.splice(0, 5);
      this.players.set(p.seat, {
        seat: p.seat,
        userId: p.userId,
        username: p.username,
        holeCards: hole,
        exposedCards: [],
        faceUpDiscards: [],
        isFolded: false,
        isDealer: p.seat === dealerSeat,
        chipScore: initialScores[p.seat] ?? 0,
      });
    }

    // 中央翻开 1 张公共牌，确立法定宝牌 (Dora)
    const initialCommunity = deck.shift()!;
    this.communityCards.push(initialCommunity);
    this.initialDoraCard = initialCommunity;
    this.legalDoraRank = parseCard(initialCommunity).rank;

    // 剩余为摸牌堆
    this.drawPile = deck;
  }

  /**
   * 检查回合开始时的终局触发（摸空猝死判决）
   */
  public checkTurnStartConditions(): { shouldEnd: boolean; reason?: GameEndReason } {
    if (this.isHandFinished) {
      return { shouldEnd: true, reason: this.endReason };
    }

    // 摸空猝死：任意玩家回合开始时，若摸牌堆不足 2 张，强制结束开牌
    if (this.drawPile.length < 2) {
      this.triggerShowdown(GameEndReason.DECK_DEPLETED);
      return { shouldEnd: true, reason: GameEndReason.DECK_DEPLETED };
    }

    return { shouldEnd: false };
  }

  /**
   * 动作 1：弃牌换牌（内修）
   * 规则：弃1张必须全明置；弃2张必须1明1暗
   */
  public performDiscardDraw(
    seat: number,
    discardFaceUp: Card,
    discardFaceDown?: Card
  ): { drawnCards: Card[] } {
    this.validateTurn(seat);

    const player = this.players.get(seat)!;
    const discardCount = discardFaceDown ? 2 : 1;

    // 验证手牌拥有性
    if (!player.holeCards.includes(discardFaceUp)) {
      throw new Error(`Player does not have card: ${discardFaceUp}`);
    }
    if (discardFaceDown && !player.holeCards.includes(discardFaceDown)) {
      throw new Error(`Player does not have card: ${discardFaceDown}`);
    }
    if (discardFaceDown && discardFaceUp === discardFaceDown) {
      throw new Error('Face-up and Face-down discards cannot be the same card');
    }

    // 校验摸牌堆余量
    if (this.drawPile.length < discardCount) {
      throw new Error('Not enough cards in draw pile to draw');
    }

    // 从手牌中移除
    player.holeCards = player.holeCards.filter(c => c !== discardFaceUp && c !== discardFaceDown);
    // 从明置换入手牌中移除（若有）
    player.exposedCards = player.exposedCards.filter(
      c => c !== discardFaceUp && c !== discardFaceDown
    );

    // 明置牌加入玩家面前明置弃牌
    player.faceUpDiscards.push(discardFaceUp);
    // 暗置牌加入公共废牌堆
    if (discardFaceDown) {
      this.discardPile.push(discardFaceDown);
    }

    // 摸等量新牌
    const drawnCards = this.drawPile.splice(0, discardCount);
    player.holeCards.push(...drawnCards);

    this.recordAction(seat, TurnActionType.DISCARD_DRAW, {
      discardFaceUp,
      discardFaceDownCount: discardFaceDown ? 1 : 0,
      discardFaceDown,
      drawCount: discardCount,
      drawnCards: [...drawnCards],
    });

    this.advanceTurn();
    return { drawnCards };
  }

  /**
   * 动作 2A：操控公牌 - 公私置换 (Swap)
   * 用手牌中的 1 张牌与公区 1 张牌互换；换入手牌保持明置且不可再次回公区
   */
  public performSwap(seat: number, handCard: Card, boardCard: Card): void {
    this.validateTurn(seat);

    const player = this.players.get(seat)!;
    if (!player.holeCards.includes(handCard)) {
      throw new Error(`Player does not hold: ${handCard}`);
    }
    // 换入的手牌不可再次换回公区
    if (player.exposedCards.includes(handCard)) {
      throw new Error('Previously swapped exposed cards cannot be swapped back to board');
    }
    const boardIdx = this.communityCards.indexOf(boardCard);
    if (boardIdx === -1) {
      throw new Error(`Board does not have card: ${boardCard}`);
    }

    // 交换
    player.holeCards = player.holeCards.filter(c => c !== handCard);
    player.holeCards.push(boardCard);
    player.exposedCards.push(boardCard); // 标记为明置手牌

    this.communityCards[boardIdx] = handCard; // 手牌移入公区成为公牌

    this.recordAction(seat, TurnActionType.MANIPULATE_SWAP, {
      swappedHandCard: handCard,
      swappedBoardCard: boardCard,
    });

    this.advanceTurn();
  }

  /**
   * 动作 2B：操控公牌 - 放逐刷新 (Banish & Refresh)
   * 公区 1 张牌移入废牌堆，从摸牌堆顶翻 1 张新牌补入
   */
  public performBanish(seat: number, boardCard: Card): { refreshedCard: Card } {
    this.validateTurn(seat);

    const boardIdx = this.communityCards.indexOf(boardCard);
    if (boardIdx === -1) {
      throw new Error(`Board does not have card: ${boardCard}`);
    }
    if (this.drawPile.length < 1) {
      throw new Error('Draw pile is empty, cannot refresh');
    }

    this.discardPile.push(boardCard);
    const refreshedCard = this.drawPile.shift()!;
    this.communityCards[boardIdx] = refreshedCard;

    this.recordAction(seat, TurnActionType.MANIPULATE_BANISH, {
      banishedCard: boardCard,
      refreshedCard,
    });

    this.advanceTurn();
    return { refreshedCard };
  }

  /**
   * 动作 3：增加公牌 (Expand Board)
   * 牌堆顶盲翻 1 张直接加至公区，公牌数永久 +1
   */
  public performExpandBoard(seat: number): { expandedCard: Card } {
    this.validateTurn(seat);

    if (this.drawPile.length < 1) {
      throw new Error('Draw pile is empty, cannot expand board');
    }

    const expandedCard = this.drawPile.shift()!;
    this.communityCards.push(expandedCard);

    this.recordAction(seat, TurnActionType.EXPAND_BOARD, {
      expandedCard,
    });

    this.advanceTurn();
    return { expandedCard };
  }

  /**
   * 动作 4：弃牌跑路 (Fold)
   * 支付当前巡目数筹码进底池，扣牌离场，免除终局赔付
   */
  public performFold(seat: number): { foldCost: number; isLoneSurvivor: boolean } {
    this.validateTurn(seat);

    const player = this.players.get(seat)!;
    const foldCost = this.currentOrbit;

    player.isFolded = true;
    player.foldOrbit = this.currentOrbit;
    player.chipScore -= foldCost; // 扣减跑路费
    this.currentPot += foldCost;  // 跑路费进入底池

    // 扣下手牌投入废牌堆
    this.discardPile.push(...player.holeCards);
    player.holeCards = [];
    player.exposedCards = [];

    this.recordAction(seat, TurnActionType.FOLD, {
      foldCost,
    });

    // 检查是否独存获胜 (Lone Survivor)
    const activePlayers = Array.from(this.players.values()).filter(p => !p.isFolded);
    if (activePlayers.length === 1) {
      this.triggerShowdown(GameEndReason.LONE_SURVIVOR);
      return { foldCost, isLoneSurvivor: true };
    }

    this.advanceTurn();
    return { foldCost, isLoneSurvivor: false };
  }

  /**
   * 动作 5：终结决战 (Call Showdown)
   */
  public performCallShowdown(seat: number): HandSettlement {
    this.validateTurn(seat);

    this.recordAction(seat, TurnActionType.CALL_SHOWDOWN, {});
    return this.triggerShowdown(GameEndReason.VOLUNTARY_SHOWDOWN, seat);
  }

  /**
   * 核心结算与裁判仲裁
   */
  public triggerShowdown(reason: GameEndReason, callerSeat?: number): HandSettlement {
    this.isHandFinished = true;
    this.endReason = reason;

    const activePlayers = Array.from(this.players.values()).filter(p => !p.isFolded);

    // 1. 独存获胜情形
    if (reason === GameEndReason.LONE_SURVIVOR || activePlayers.length === 1) {
      const winner = activePlayers[0];
      const winProfit = this.currentPot;
      winner.chipScore += winProfit;

      const settlement: HandSettlement = {
        endReason: GameEndReason.LONE_SURVIVOR,
        finalOrbit: this.currentOrbit,
        finalCommunityCards: [...this.communityCards],
        legalDoraRank: this.legalDoraRank,
        baseScore: 0,
        winnerSeats: [winner.seat],
        playerResults: Array.from(this.players.values()).map(p => ({
          seat: p.seat,
          userId: p.userId,
          username: p.username,
          isWinner: p.seat === winner.seat,
          isFolded: p.isFolded,
          revealedHoleCards: [...p.holeCards],
          doraInBestHand: 0,
          scoreChange: p.seat === winner.seat ? winProfit : -(p.foldOrbit ?? 0),
          cumulativeScore: p.chipScore,
        })),
      };
      this.settlement = settlement;
      return settlement;
    }

    // 2. 正常决战比牌情形 (Showdown)
    // 评估所有在场玩家的客观最佳5张牌组合
    const evaluatedList = activePlayers.map(p => ({
      player: p,
      bestHand: findBestHand(p.holeCards, this.communityCards, this.legalDoraRank),
    }));

    // 排序找出最大成牌
    evaluatedList.sort((a, b) => compare5CardHands(b.bestHand, a.bestHand));
    const highestHand = evaluatedList[0].bestHand;

    // 找出所有并列第一的胜者 (Chop)
    const winners = evaluatedList.filter(
      item => compare5CardHands(item.bestHand, highestHand) === 0
    );
    const winnerSeats = winners.map(w => w.player.seat);

    // 胜者成牌中的宝牌数 (若平局取最高者)
    const winnerDoraCount = Math.max(...winners.map(w => w.bestHand.doraCount));

    // 计算基础分: 终局公牌数 + 终局巡目数 + 胜者成牌中的宝牌数
    const baseScore = this.communityCards.length + this.currentOrbit + winnerDoraCount;

    // 输赢赔付结算：
    // 在场输家每人支付 1 份基础分
    const losers = evaluatedList.filter(item => !winnerSeats.includes(item.player.seat));
    const totalLoserPayout = losers.length * baseScore;
    const totalPrizePool = totalLoserPayout + this.currentPot; // 输家赔付 + 跑路底池

    for (const loser of losers) {
      loser.player.chipScore -= baseScore;
    }

    // 胜者平分总奖金池
    const share = Math.floor(totalPrizePool / winners.length);
    let remainder = totalPrizePool % winners.length;

    // 余数顺位优先：从庄家位起顺时针首位胜者优先获得
    let oddChipWinnerSeat: number | undefined;
    if (remainder > 0) {
      // 按照从 dealerSeat 起顺时针排序所有玩家座位
      const seatsInClockwise: number[] = [];
      for (let i = 0; i < this.playerCount; i++) {
        const s = ((this.dealerSeat - 1 + i) % this.playerCount) + 1;
        seatsInClockwise.push(s);
      }
      oddChipWinnerSeat = seatsInClockwise.find(s => winnerSeats.includes(s));
    }

    for (const winner of winners) {
      let winAmount = share;
      if (remainder > 0 && winner.player.seat === oddChipWinnerSeat) {
        winAmount += remainder;
      }
      winner.player.chipScore += winAmount;
    }

    const settlement: HandSettlement = {
      endReason: reason,
      finalOrbit: this.currentOrbit,
      finalCommunityCards: [...this.communityCards],
      legalDoraRank: this.legalDoraRank,
      baseScore,
      winnerSeats,
      oddChipWinnerSeat,
      playerResults: Array.from(this.players.values()).map(p => {
        const isWinner = winnerSeats.includes(p.seat);
        const evalItem = evaluatedList.find(e => e.player.seat === p.seat);
        let scoreChange = 0;
        if (p.isFolded) {
          scoreChange = -(p.foldOrbit ?? 0);
        } else if (isWinner) {
          scoreChange = (share + (p.seat === oddChipWinnerSeat ? remainder : 0));
        } else {
          scoreChange = -baseScore;
        }

        return {
          seat: p.seat,
          userId: p.userId,
          username: p.username,
          isWinner,
          isFolded: p.isFolded,
          revealedHoleCards: [...p.holeCards],
          bestHand: evalItem?.bestHand,
          doraInBestHand: evalItem?.bestHand.doraCount ?? 0,
          scoreChange,
          cumulativeScore: p.chipScore,
        };
      }),
    };

    this.settlement = settlement;
    return settlement;
  }

  /**
   * 推进至下一顺位玩家行动，并维护巡目递增
   */
  private advanceTurn(): void {
    if (this.isHandFinished) return;

    let nextSeat = this.currentTurnSeat;
    let attempts = 0;

    do {
      nextSeat = (nextSeat % this.playerCount) + 1;
      attempts++;
      if (attempts > this.playerCount) {
        // 全部玩家均已跑路或无可行走位
        return;
      }
    } while (this.players.get(nextSeat)?.isFolded);

    // 若新轮到的人是庄家且在此之前有其他行动，巡目递增 1
    if (nextSeat === this.dealerSeat) {
      this.currentOrbit += 1;
    }

    this.currentTurnSeat = nextSeat;
  }

  private validateTurn(seat: number): void {
    if (this.isHandFinished) {
      throw new Error('Hand has already concluded');
    }
    if (this.currentTurnSeat !== seat) {
      throw new Error(`Not player's turn. Current turn: Seat ${this.currentTurnSeat}, caller: Seat ${seat}`);
    }
    const player = this.players.get(seat);
    if (!player || player.isFolded) {
      throw new Error('Player is folded or invalid');
    }
  }

  private recordAction(seat: number, action: TurnActionType, details: HandActionLogItem['details']): void {
    this.stepCounter++;
    const player = this.players.get(seat)!;
    const playerSnapshots = Array.from(this.players.values()).map(p => ({
      seat: p.seat,
      holeCards: [...p.holeCards],
      exposedCards: [...p.exposedCards],
      isFolded: p.isFolded,
    }));
    this.actionLogs.push({
      step: this.stepCounter,
      orbit: this.currentOrbit,
      seat,
      username: player.username,
      action,
      details,
      communityCardsAfter: [...this.communityCards],
      playerSnapshots,
      timestamp: Date.now(),
    });
  }

  /**
   * 导出面向全体客户端的脱敏公开状态快照
   */
  public getPublicState(): PublicGameState {
    return {
      roomId: this.roomId,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      currentOrbit: this.currentOrbit,
      dealerSeat: this.dealerSeat,
      currentTurnSeat: this.currentTurnSeat,
      legalDoraRank: this.legalDoraRank,
      initialDoraCard: this.initialDoraCard,
      communityCards: [...this.communityCards],
      drawPileCount: this.drawPile.length,
      discardPileCount: this.discardPile.length,
      currentPot: this.currentPot,
      baseScoreEstimate: this.communityCards.length + this.currentOrbit,
      players: Array.from(this.players.values()).map(p => ({
        seat: p.seat,
        userId: p.userId,
        username: p.username,
        cardCount: p.holeCards.length,
        exposedCards: [...p.exposedCards],
        faceUpDiscards: [...p.faceUpDiscards],
        isFolded: p.isFolded,
        foldOrbit: p.foldOrbit,
        isDealer: p.isDealer,
        chipScore: p.chipScore,
      })),
      isHandFinished: this.isHandFinished,
      gameStatus: this.isHandFinished ? 'round_end' : 'playing',
    };
  }

  /**
   * 导出指定玩家的私有状态（含自己的底牌）
   */
  public getPrivateStateForSeat(seat: number): PrivatePlayerState | null {
    const player = this.players.get(seat);
    if (!player) return null;
    return {
      seat: player.seat,
      userId: player.userId,
      username: player.username,
      cardCount: player.holeCards.length,
      exposedCards: [...player.exposedCards],
      faceUpDiscards: [...player.faceUpDiscards],
      isFolded: player.isFolded,
      foldOrbit: player.foldOrbit,
      isDealer: player.isDealer,
      chipScore: player.chipScore,
      holeCards: [...player.holeCards], // 私有手牌
    };
  }
}
