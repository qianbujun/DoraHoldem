// 宿命公牌 (Dora Hold'em) - 房间与多局流转管理器

import { GameHandState } from '../engine/gameState.js';
import { dbService } from '../db/database.js';
import { Card, Rank } from '../engine/card.js';
import { GameEndReason } from '../shared/types.js';

export interface RoomPlayer {
  userId: number;
  username: string;
  seat: number; // 1 ~ maxPlayers
  isReady: boolean;
  isOnline: boolean;
  cumulativeScore: number;
  isAi?: boolean;
  aiDifficulty?: 'easy' | 'medium' | 'hard';
}

export class GameRoom {
  public readonly id: string;
  public readonly code: string;
  public readonly ownerId: number;
  public readonly maxPlayers: number;
  public readonly totalRounds: number;
  public readonly password?: string;

  public status: 'waiting' | 'playing' | 'round_end' | 'finished' = 'waiting';
  public currentRound: number = 0;
  public currentDealerSeat: number = 1;
  public players: Map<number, RoomPlayer> = new Map(); // seat -> RoomPlayer
  public currentHand: GameHandState | null = null;

  constructor(
    code: string,
    ownerId: number,
    maxPlayers: number,
    totalRounds: number,
    password?: string
  ) {
    if (totalRounds % maxPlayers !== 0) {
      throw new Error(`Total rounds (${totalRounds}) must be an exact multiple of player count (${maxPlayers})`);
    }
    this.id = code;
    this.code = code;
    this.ownerId = ownerId;
    this.maxPlayers = maxPlayers;
    this.totalRounds = totalRounds;
    this.password = password;
  }

  public addPlayer(userId: number, username: string, preferredSeat?: number): RoomPlayer {
    if (this.status !== 'waiting') {
      throw new Error('Game already started');
    }

    // 检查是否已经在房间内
    for (const p of this.players.values()) {
      if (p.userId === userId) {
        p.isOnline = true;
        return p;
      }
    }

    if (this.players.size >= this.maxPlayers) {
      throw new Error('Room is full');
    }

    // 寻找空闲座位
    let seat = preferredSeat;
    if (!seat || seat < 1 || seat > this.maxPlayers || this.players.has(seat)) {
      for (let s = 1; s <= this.maxPlayers; s++) {
        if (!this.players.has(s)) {
          seat = s;
          break;
        }
      }
    }

    const player: RoomPlayer = {
      userId,
      username,
      seat: seat!,
      isReady: userId === this.ownerId, // 房主默认就绪
      isOnline: true,
      cumulativeScore: 0,
    };

    this.players.set(seat!, player);
    return player;
  }

  public removePlayer(userId: number): void {
    if (this.status !== 'waiting') {
      const p = Array.from(this.players.values()).find(pl => pl.userId === userId);
      if (p) p.isOnline = false;
      return;
    }
    for (const [seat, p] of this.players.entries()) {
      if (p.userId === userId) {
        this.players.delete(seat);
        break;
      }
    }
  }

  public addAiPlayer(difficulty: 'easy' | 'medium' | 'hard' = 'medium'): RoomPlayer {
    if (this.status !== 'waiting') {
      throw new Error('Game already started');
    }
    if (this.players.size >= this.maxPlayers) {
      throw new Error('Room is full');
    }

    let seat: number | undefined;
    for (let s = 1; s <= this.maxPlayers; s++) {
      if (!this.players.has(s)) {
        seat = s;
        break;
      }
    }

    if (!seat) {
      throw new Error('No available seats');
    }

    const aiUserId = -100 - seat;
    const aiNames: Record<'easy' | 'medium' | 'hard', string[]> = {
      easy: ['[AI·初级] 豆包牌友', '[AI·初级] 休闲阿宝', '[AI·初级] 萌新小卒'],
      medium: ['[AI·中级] 战术阿策', '[AI·中级] 稳健牌手', '[AI·中级] 算数张三'],
      hard: ['[AI·高级] 宿命算圣', '[AI·高级] 蒙特卡洛', '[AI·高级] 胜率大师'],
    };
    const nameList = aiNames[difficulty] || aiNames.medium;
    const username = nameList[(seat - 1) % nameList.length];

    const aiPlayer: RoomPlayer = {
      userId: aiUserId,
      username,
      seat,
      isReady: true,
      isOnline: true,
      cumulativeScore: 0,
      isAi: true,
      aiDifficulty: difficulty,
    };

    this.players.set(seat, aiPlayer);
    return aiPlayer;
  }

  public removeAiPlayer(seat: number): boolean {
    if (this.status !== 'waiting') {
      throw new Error('Cannot remove AI after game started');
    }
    const p = this.players.get(seat);
    if (p && p.isAi) {
      this.players.delete(seat);
      return true;
    }
    return false;
  }

  public startFirstRound(): GameHandState {
    if (this.players.size !== this.maxPlayers) {
      throw new Error(`Cannot start: requires exactly ${this.maxPlayers} players`);
    }

    this.currentRound = 1;
    this.currentDealerSeat = 1; // 第 1 局由 1 号位坐庄
    this.status = 'playing';

    return this.initHand();
  }

  public startNextRound(): GameHandState {
    if (this.status !== 'round_end') {
      throw new Error('Cannot start next round: current round not ended');
    }

    if (this.currentRound >= this.totalRounds) {
      this.status = 'finished';
      throw new Error('Match finished: all rounds completed');
    }

    this.currentRound += 1;
    // 庄家顺时针轮换
    this.currentDealerSeat = (this.currentDealerSeat % this.maxPlayers) + 1;
    this.status = 'playing';

    return this.initHand();
  }

  private initHand(): GameHandState {
    const playerInputs = Array.from(this.players.values()).map(p => ({
      seat: p.seat,
      userId: p.userId,
      username: p.username,
    }));

    const initialScores: Record<number, number> = {};
    for (const p of this.players.values()) {
      initialScores[p.seat] = p.cumulativeScore;
    }

    this.currentHand = new GameHandState(
      this.code,
      this.currentRound,
      this.totalRounds,
      this.currentDealerSeat,
      playerInputs,
      initialScores
    );

    return this.currentHand;
  }

  public async finishCurrentHand(): Promise<any> {
    if (!this.currentHand || !this.currentHand.settlement) return;

    this.status = this.currentRound >= this.totalRounds ? 'finished' : 'round_end';

    // 同步玩家累计分数
    for (const res of this.currentHand.settlement.playerResults) {
      const p = this.players.get(res.seat);
      if (p) {
        p.cumulativeScore = res.cumulativeScore;
      }
    }

    // 保存单小局牌谱至数据库（并触发 50 滚动清理与位置战绩更新）
    try {
      const handData = {
        round_number: this.currentRound,
        player_count: this.maxPlayers,
        dealer_user_id: this.players.get(this.currentDealerSeat)?.userId || 0,
        dora_rank: this.currentHand.legalDoraRank,
        initial_dora_card: this.currentHand.initialDoraCard,
        final_community_cards: this.currentHand.communityCards,
        final_orbit: this.currentHand.currentOrbit,
        base_score: this.currentHand.settlement.baseScore,
        total_pot: this.currentHand.currentPot,
        end_reason: this.currentHand.settlement.endReason,
        action_history: {
          actions: this.currentHand.actionLogs,
          settlement: this.currentHand.settlement,
          playerHands: Array.from(this.currentHand.players.values()).map(p => ({
            seat: p.seat,
            userId: p.userId,
            username: p.username,
            holeCards: p.holeCards,
            exposedCards: p.exposedCards,
            isFolded: p.isFolded,
          })),
        },
      };

      const userResults = this.currentHand.settlement.playerResults.map(pr => {
        const pState = this.currentHand!.players.get(pr.seat)!;
        // 核心修复：按规则计算相对庄家位置 (1: 庄家位, 2: 顺时针第二位, ..., N: 顺时针第N位)
        const relativePosition = ((pr.seat - this.currentDealerSeat + this.maxPlayers) % this.maxPlayers) + 1;
        return {
          user_id: pr.userId,
          seat_position: relativePosition,
          is_dealer: pr.seat === this.currentDealerSeat,
          initial_hole_cards: pState.holeCards,
          exposed_cards: pState.exposedCards,
          final_best_hand: pr.bestHand ? {
            rank: pr.bestHand.rank,
            rankNameKey: pr.bestHand.rankNameKey,
            best5Cards: pr.bestHand.best5Cards,
          } : undefined,
          hand_category: pr.bestHand?.rankNameKey || undefined,
          dora_count: pr.doraInBestHand,
          is_folded: pr.isFolded,
          fold_orbit: pState.foldOrbit,
          is_winner: pr.isWinner,
          net_score: pr.scoreChange,
        };
      });

      const handId = await dbService.saveHandRecord(handData, userResults);
      this.currentHand.settlement.handRecordId = handId;
    } catch (err) {
      console.error('[Room] Failed to persist hand record:', err);
    }

    return this.currentHand.settlement;
  }

  public getPublicRoomInfo() {
    return {
      code: this.code,
      ownerId: this.ownerId,
      maxPlayers: this.maxPlayers,
      totalRounds: this.totalRounds,
      hasPassword: Boolean(this.password),
      status: this.status,
      currentRound: this.currentRound,
      currentDealerSeat: this.currentDealerSeat,
      playerCount: this.players.size,
      players: Array.from(this.players.values()).map(p => ({
        seat: p.seat,
        userId: p.userId,
        username: p.username,
        isReady: p.isReady,
        isOnline: p.isOnline,
        cumulativeScore: p.cumulativeScore,
        isAi: Boolean(p.isAi),
        aiDifficulty: p.aiDifficulty,
      })),
    };
  }
}

class RoomManager {
  private rooms: Map<string, GameRoom> = new Map();

  public createRoom(
    ownerId: number,
    maxPlayers: number,
    totalRounds: number,
    password?: string
  ): GameRoom {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = new GameRoom(code, ownerId, maxPlayers, totalRounds, password);
    this.rooms.set(code, room);
    return room;
  }

  public getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public listPublicRooms() {
    return Array.from(this.rooms.values())
      .filter(r => r.status === 'waiting')
      .map(r => r.getPublicRoomInfo());
  }
}

export const roomManager = new RoomManager();
