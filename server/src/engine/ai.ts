// 宿命公牌 (Dora Hold'em) - 三级难度 AI 决策引擎

import { Card, Rank, parseCard, createDeck } from './card.js';
import {
  findBestHand,
  compare5CardHands,
  evaluate5Cards,
  HandRank,
} from './evaluator.js';
import { TurnActionType, GameEndReason } from '../shared/types.js';
import { PlayerRuntimeState, GameHandState } from './gameState.js';

export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface AiDecision {
  action: TurnActionType;
  discardFaceUp?: Card;
  discardFaceDown?: Card;
  swappedHandCard?: Card;
  swappedBoardCard?: Card;
  banishBoardCard?: Card;
}

/**
 * 随机从数组中挑选一个元素
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 获取玩家手中可以合法换出的手牌（换入的明置手牌不可再次换回公区）
 */
function getSwappableHoleCards(player: PlayerRuntimeState): Card[] {
  return player.holeCards.filter(c => !player.exposedCards.includes(c));
}

/**
 * 计算当前已知死牌集合（自身手牌 + 全场公牌 + 所有玩家明置换入手牌 + 所有玩家明置弃牌）
 */
function getKnownDeadCards(game: GameHandState, selfSeat: number): Set<Card> {
  const dead = new Set<Card>();
  const self = game.players.get(selfSeat)!;

  // 自己的全部手牌
  self.holeCards.forEach(c => dead.add(c));

  // 公牌
  game.communityCards.forEach(c => dead.add(c));

  // 全场所有玩家的明置换入手牌与明置弃牌
  for (const p of game.players.values()) {
    p.exposedCards.forEach(c => dead.add(c));
    p.faceUpDiscards.forEach(c => dead.add(c));
  }

  return dead;
}

/**
 * 快速蒙特卡洛模拟评估胜率（无作弊，仅基于未见牌堆）
 */
function estimateWinRate(
  myHoleCards: Card[],
  communityCards: Card[],
  legalDoraRank: Rank,
  activeOpponentsCount: number,
  knownDeadCards: Set<Card>,
  simulations: number = 100
): number {
  // 构建剩余未见牌堆
  const fullDeck = createDeck();
  const unseenCards: Card[] = fullDeck.filter(c => !knownDeadCards.has(c));

  if (unseenCards.length < activeOpponentsCount * 5) {
    return 0.5;
  }

  let wins = 0;
  const myEval = findBestHand(myHoleCards, communityCards, legalDoraRank);

  for (let sim = 0; sim < simulations; sim++) {
    // 简单打乱部分未见牌分发给对手
    const shuffled = [...unseenCards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let isIWin = true;
    for (let opp = 0; opp < activeOpponentsCount; opp++) {
      const oppHole = shuffled.slice(opp * 5, opp * 5 + 5);
      const oppEval = findBestHand(oppHole, communityCards, legalDoraRank);
      if (compare5CardHands(oppEval, myEval) > 0) {
        isIWin = false;
        break;
      }
    }

    if (isIWin) {
      wins++;
    }
  }

  return wins / simulations;
}

// ==========================================
// 1. 初级 AI (Easy / 休闲萌新)
// 特点：行为随机性高，依靠直觉，弃牌随意，几乎不跑路
// ==========================================
function decideEasy(game: GameHandState, selfSeat: number): AiDecision {
  const self = game.players.get(selfSeat)!;
  const swappableCards = getSwappableHoleCards(self);
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);

  // 若牌型已经达到两对以上且处于第2巡以上，有概率直接开牌
  if (myEval.rank >= HandRank.TWO_PAIR && game.currentOrbit >= 2 && Math.random() < 0.6) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  // 若手牌仅为高牌且摸牌堆充足，偏向弃牌换牌
  const roll = Math.random();
  if (roll < 0.5 && game.drawPile.length >= 2 && self.holeCards.length >= 2) {
    // 随机弃 1~2 张牌
    const discard2 = Math.random() < 0.6;
    if (discard2) {
      const c1 = self.holeCards[0];
      const c2 = self.holeCards[1];
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: c1,
        discardFaceDown: c2,
      };
    } else {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: self.holeCards[0],
      };
    }
  }

  // 20% 概率公私置换
  if (roll >= 0.5 && roll < 0.7 && swappableCards.length > 0 && game.communityCards.length > 0) {
    return {
      action: TurnActionType.MANIPULATE_SWAP,
      swappedHandCard: pickRandom(swappableCards),
      swappedBoardCard: pickRandom(game.communityCards),
    };
  }

  // 15% 概率增加公牌
  if (roll >= 0.7 && roll < 0.85 && game.drawPile.length >= 1) {
    return { action: TurnActionType.EXPAND_BOARD };
  }

  // 10% 概率放逐刷新
  if (roll >= 0.85 && roll < 0.95 && game.communityCards.length > 0 && game.drawPile.length >= 1) {
    return {
      action: TurnActionType.MANIPULATE_BANISH,
      banishBoardCard: pickRandom(game.communityCards),
    };
  }

  // 极端巡目（>=4）且高牌时才可能跑路
  if (game.currentOrbit >= 4 && myEval.rank === HandRank.HIGH_CARD && Math.random() < 0.5) {
    return { action: TurnActionType.FOLD };
  }

  // 默认直接开牌决战
  return { action: TurnActionType.CALL_SHOWDOWN };
}

// ==========================================
// 2. 中级 AI (Medium / 稳健战术)
// 特点：计算当前手牌最大成牌，保护宝牌，针对性换牌，适度止损
// ==========================================
function decideMedium(game: GameHandState, selfSeat: number): AiDecision {
  const self = game.players.get(selfSeat)!;
  const swappableCards = getSwappableHoleCards(self);
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);

  // 1. 若已经是三条、顺子、同花或更强，且巡目 >= 2，果断终结开牌！
  if (myEval.rank >= HandRank.THREE_OF_A_KIND && game.currentOrbit >= 2) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  // 2. 检查公区置换机会：是否存在能让手牌提升或带来宝牌的置换？
  if (swappableCards.length > 0 && game.communityCards.length > 0) {
    for (const bCard of game.communityCards) {
      // 若公牌是宝牌，且自己尚未持有，或能组成对子
      for (const hCard of swappableCards) {
        const testHole = self.holeCards.filter(c => c !== hCard).concat([bCard]);
        const testEval = findBestHand(testHole, game.communityCards, game.legalDoraRank);
        if (compare5CardHands(testEval, myEval) > 0 || (testEval.doraCount > myEval.doraCount && compare5CardHands(testEval, myEval) >= 0)) {
          return {
            action: TurnActionType.MANIPULATE_SWAP,
            swappedHandCard: hCard,
            swappedBoardCard: bCard,
          };
        }
      }
    }
  }

  // 3. 止损判断 (Fold)：若当前巡目 >= 2，且手牌极差（高牌且没有宝牌），且摸牌堆剩余不多
  if (game.currentOrbit >= 2 && myEval.rank === HandRank.HIGH_CARD && myEval.doraCount === 0) {
    // 跑路费 = currentOrbit。若终局失败赔付基础分通常 >= 3(公)+2(巡)+1 = 6分
    // 在期望上，跑路损失 2 分远优于赔付 6+ 分
    if (Math.random() < 0.7) {
      return { action: TurnActionType.FOLD };
    }
  }

  // 4. 精准弃牌换牌：识别未参与当前最佳成牌的废牌
  if (game.drawPile.length >= 2 && self.holeCards.length >= 2) {
    const best5Set = new Set(myEval.best5Cards);
    // 优先弃掉不在最佳成牌中的手牌（且非宝牌）
    const uselessCards = self.holeCards.filter(
      c => !best5Set.has(c) && c[0] !== game.legalDoraRank
    );

    if (uselessCards.length >= 2) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: uselessCards[0],
        discardFaceDown: uselessCards[1],
      };
    } else if (uselessCards.length === 1) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: uselessCards[0],
      };
    }
  }

  // 5. 若公牌很少（<= 2张），考虑增加公牌以提升基础分与做牌池
  if (game.communityCards.length <= 2 && game.drawPile.length >= 1) {
    return { action: TurnActionType.EXPAND_BOARD };
  }

  // 默认：两对以上或第3巡以上开牌
  if (myEval.rank >= HandRank.TWO_PAIR || game.currentOrbit >= 3) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  // 兜底：弃1张手牌
  return {
    action: TurnActionType.DISCARD_DRAW,
    discardFaceUp: self.holeCards[self.holeCards.length - 1],
  };
}

// ==========================================
// 3. 高级 AI (Hard / 算力大师 - 期望值 EV & 蒙特卡洛)
// 特点：全面运用死牌分析、胜率模拟、数学期望值 EV 最大化决策
// ==========================================
function decideHard(game: GameHandState, selfSeat: number): AiDecision {
  const self = game.players.get(selfSeat)!;
  const swappableCards = getSwappableHoleCards(self);
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);

  const activeOpponents = Array.from(game.players.values()).filter(p => !p.isFolded && p.seat !== selfSeat);
  const deadCards = getKnownDeadCards(game, selfSeat);

  // 估算当前胜率
  const winRate = estimateWinRate(
    self.holeCards,
    game.communityCards,
    game.legalDoraRank,
    activeOpponents.length,
    deadCards,
    120
  );

  // 当前预期单局基础分
  const expectedBaseScore = game.communityCards.length + game.currentOrbit + myEval.doraCount;
  // 决战期望值 EV = P(win) * (输家数 * BaseScore + 底池) - (1 - P(win)) * BaseScore
  const winPot = activeOpponents.length * expectedBaseScore + game.currentPot;
  const showdownEV = winRate * winPot - (1 - winRate) * expectedBaseScore;
  const foldEV = -game.currentOrbit;

  // 1. 决胜开牌判定：若胜率极高 (> 65%) 或 EV 显著为正且巡目 >= 2，立即开牌锁定胜局！
  if (winRate >= 0.65 || (showdownEV > 3 && game.currentOrbit >= 2)) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  // 2. 深度止损跑路判定 (Cut Losses):
  // 若胜率极低 (< 20%) 且 foldEV 显著好于 showdownEV
  if (winRate < 0.20 && game.currentOrbit >= 2 && foldEV > showdownEV) {
    return { action: TurnActionType.FOLD };
  }

  // 3. 寻找最优公私置换 (Swap EV Optimization):
  if (swappableCards.length > 0 && game.communityCards.length > 0) {
    let bestSwap: { handCard: Card; boardCard: Card; gainWinRate: number } | null = null;

    for (const bCard of game.communityCards) {
      for (const hCard of swappableCards) {
        const testHole = self.holeCards.filter(c => c !== hCard).concat([bCard]);
        const testBoard = game.communityCards.map(c => (c === bCard ? hCard : c));
        const testDead = new Set(deadCards);
        testDead.add(bCard);
        testDead.add(hCard);

        const newWinRate = estimateWinRate(
          testHole,
          testBoard,
          game.legalDoraRank,
          activeOpponents.length,
          testDead,
          40
        );

        if (newWinRate > winRate + 0.08) {
          if (!bestSwap || newWinRate > bestSwap.gainWinRate) {
            bestSwap = { handCard: hCard, boardCard: bCard, gainWinRate: newWinRate };
          }
        }
      }
    }

    if (bestSwap) {
      return {
        action: TurnActionType.MANIPULATE_SWAP,
        swappedHandCard: bestSwap.handCard,
        swappedBoardCard: bestSwap.boardCard,
      };
    }
  }

  // 4. 增加公牌 (Expand Board)：若自身牌力需要更多公区配合（如听顺子/听同花），且牌堆充足
  if (game.communityCards.length < 4 && game.drawPile.length >= 2 && winRate < 0.50 && Math.random() < 0.4) {
    return { action: TurnActionType.EXPAND_BOARD };
  }

  // 5. 科学弃牌换牌 (Discard & Draw)：
  // 找出对最终成牌贡献最小的 1~2 张牌丢弃
  if (game.drawPile.length >= 2 && self.holeCards.length >= 2) {
    const bestSet = new Set(myEval.best5Cards);
    // 排序：不在最佳成牌中且不是宝牌的点数从小到大排在最前面
    const candidates = self.holeCards
      .filter(c => !bestSet.has(c) && c[0] !== game.legalDoraRank)
      .sort((a, b) => parseCard(a).value - parseCard(b).value);

    if (candidates.length >= 2) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: candidates[0],
        discardFaceDown: candidates[1],
      };
    } else if (candidates.length === 1) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: candidates[0],
      };
    }
  }

  // 6. 若公牌有废牌阻碍且牌堆充裕，尝试放逐公区最小无关牌
  if (game.communityCards.length > 2 && game.drawPile.length >= 2) {
    const nonDoraBoard = game.communityCards.filter(c => c[0] !== game.legalDoraRank);
    if (nonDoraBoard.length > 0) {
      return {
        action: TurnActionType.MANIPULATE_BANISH,
        banishBoardCard: nonDoraBoard[0],
      };
    }
  }

  // 最终兜底：开牌比大小
  return { action: TurnActionType.CALL_SHOWDOWN };
}

/**
 * 统一 AI 决策调度入口
 */
export function executeAiDecision(
  game: GameHandState,
  selfSeat: number,
  difficulty: AiDifficulty
): AiDecision {
  switch (difficulty) {
    case 'easy':
      return decideEasy(game, selfSeat);
    case 'medium':
      return decideMedium(game, selfSeat);
    case 'hard':
      return decideHard(game, selfSeat);
    default:
      return decideMedium(game, selfSeat);
  }
}

