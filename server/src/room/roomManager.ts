// 宿命公牌 (Dora Hold'em) - 房间与多局流转管理器

import { GameHandState } from '../engine/gameState.js';
import { dbService } from '../db/database.js';
import { Card, Rank } from '../engine/card.js';
import { EndGameRequestInfo, GameEndReason } from '../shared/types.js';

export interface RoomPlayer {
  userId: number;
  username: string;
  seat: number; // 1 ~ maxPlayers
  isReady: boolean;
  isOnline: boolean;
  disconnectedAt?: number;
  hasLeft?: boolean;
  cumulativeScore: number;
  isAi?: boolean;
  aiDifficulty?: 'easy' | 'medium' | 'hard' | 'ultimate';
}

export interface RoomExpirationOptions {
  waitingOfflineTtlMs?: number;
  activeOfflineTtlMs?: number;
  finishedOfflineTtlMs?: number;
  idleMaxTtlMs?: number;
}

export class GameRoom {
  public readonly id: string;
  public readonly code: string;
  public ownerId: number;
  public readonly maxPlayers: number;
  public readonly totalRounds: number;
  public readonly password?: string;

  public status: 'waiting' | 'playing' | 'round_end' | 'finished' = 'waiting';
  public currentRound: number = 0;
  public currentDealerSeat: number = 1;
  public players: Map<number, RoomPlayer> = new Map(); // seat -> RoomPlayer
  public currentHand: GameHandState | null = null;

  public lastActivityAt: number = Date.now();
  public allHumansOfflineSince?: number;
  public endAfterCurrentRound: boolean = false;
  public endRequestedBy?: EndGameRequestInfo;
  public endedEarly: boolean = false;
  public endedBy?: EndGameRequestInfo;

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

  public touchActivity(): void {
    this.lastActivityAt = Date.now();
  }

  public addPlayer(userId: number, username: string, preferredSeat?: number): RoomPlayer {
    // 优先检查是否已经在房间内（支持对局中/结算中/等待中刷新或断线重连归位）
    for (const p of this.players.values()) {
      if (p.userId === userId) {
        p.isOnline = true;
        p.disconnectedAt = undefined;
        p.hasLeft = false;
        if (username) p.username = username;
        this.allHumansOfflineSince = undefined;
        this.touchActivity();
        return p;
      }
    }

    if (this.status !== 'waiting') {
      throw new Error('Game already started');
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
      hasLeft: false,
      cumulativeScore: 0,
    };

    this.players.set(seat!, player);
    this.allHumansOfflineSince = undefined;
    this.touchActivity();
    return player;
  }

  public markPlayerOnline(userId: number, username?: string): RoomPlayer | undefined {
    for (const p of this.players.values()) {
      if (!p.isAi && p.userId === userId) {
        p.isOnline = true;
        p.disconnectedAt = undefined;
        p.hasLeft = false;
        if (username) p.username = username;
        this.allHumansOfflineSince = undefined;
        this.touchActivity();
        return p;
      }
    }
    return undefined;
  }

  public markPlayerOffline(userId: number): boolean {
    let changed = false;
    for (const p of this.players.values()) {
      if (!p.isAi && p.userId === userId) {
        if (p.isOnline) {
          p.isOnline = false;
          p.disconnectedAt = Date.now();
          changed = true;
        }
        break;
      }
    }
    if (this.getOnlineHumanPlayers().length === 0 && this.getHumanPlayers().length > 0) {
      this.allHumansOfflineSince = this.allHumansOfflineSince ?? Date.now();
    }
    return changed;
  }

  public removePlayer(userId: number): void {
    if (this.status !== 'waiting') {
      const p = Array.from(this.players.values()).find(pl => pl.userId === userId);
      if (p) {
        p.isOnline = false;
        p.hasLeft = true;
        p.disconnectedAt = Date.now();
        if (userId === this.ownerId) {
          const nextHuman = this.getHumanPlayers()[0];
          if (nextHuman) {
            this.ownerId = nextHuman.userId;
          }
        }
      }
      if (this.getOnlineHumanPlayers().length === 0 && this.getHumanPlayers().length > 0) {
        this.allHumansOfflineSince = this.allHumansOfflineSince ?? Date.now();
      }
      this.touchActivity();
      return;
    }
    for (const [seat, p] of this.players.entries()) {
      if (p.userId === userId) {
        this.players.delete(seat);
        // 如果房主离开了，且还有其他真实人类玩家，顺位移交房主权限
        if (userId === this.ownerId) {
          const nextHuman = this.getHumanPlayers()[0];
          if (nextHuman) {
            this.ownerId = nextHuman.userId;
            nextHuman.isReady = true;
          }
        }
        break;
      }
    }
    if (this.getOnlineHumanPlayers().length === 0 && this.getHumanPlayers().length > 0) {
      this.allHumansOfflineSince = this.allHumansOfflineSince ?? Date.now();
    }
    this.touchActivity();
  }

  // 获取房间内所有未主动退出的人类玩家（含暂离/断线待重连玩家）
  public getHumanPlayers(): RoomPlayer[] {
    return Array.from(this.players.values()).filter(p => !p.isAi && !p.hasLeft);
  }

  // 获取当前在线的真实人类玩家
  public getOnlineHumanPlayers(): RoomPlayer[] {
    return Array.from(this.players.values()).filter(p => !p.isAi && !p.hasLeft && p.isOnline);
  }

  // 检查房间是否已经没有真实人类（空房间，或只剩下 AI 机器人）
  public isEmptyOrAllAi(): boolean {
    return this.getHumanPlayers().length === 0;
  }

  // 检查房间是否超过离线保护期或长期彻底闲置
  public isExpired(now: number = Date.now(), options: RoomExpirationOptions = {}): boolean {
    if (this.isEmptyOrAllAi()) {
      return true;
    }

    if (this.allHumansOfflineSince !== undefined) {
      let ttlMs: number;
      if (this.status === 'waiting') {
        ttlMs = options.waitingOfflineTtlMs ?? 60 * 60 * 1000; // 等待中全部离线保留 1 小时
      } else if (this.status === 'finished') {
        ttlMs = options.finishedOfflineTtlMs ?? 60 * 60 * 1000; // 已结算全部离线保留 1 小时
      } else {
        ttlMs = options.activeOfflineTtlMs ?? 6 * 60 * 60 * 1000; // 对局中/回合间歇保留 6 小时
      }
      if (now - this.allHumansOfflineSince >= ttlMs) {
        return true;
      }
    }

    const idleMaxTtlMs = options.idleMaxTtlMs ?? 24 * 60 * 60 * 1000;
    if (now - this.lastActivityAt >= idleMaxTtlMs) {
      return true;
    }

    return false;
  }

  public requestEndAfterRound(userId: number): {
    immediatelyFinished: boolean;
    alreadyFinished: boolean;
    pending: boolean;
  } {
    const player = Array.from(this.players.values()).find(
      p => !p.isAi && !p.hasLeft && p.userId === userId
    );
    if (!player) {
      throw new Error('Player not in room');
    }

    if (this.status === 'waiting') {
      throw new Error('Game has not started yet');
    }

    if (this.status === 'finished') {
      return { immediatelyFinished: false, alreadyFinished: true, pending: false };
    }

    const reqInfo: EndGameRequestInfo = {
      userId: player.userId,
      username: player.username,
      seat: player.seat,
      requestedAt: Date.now(),
    };

    if (this.status === 'round_end') {
      this.endAfterCurrentRound = false;
      this.endRequestedBy = undefined;
      this.endedEarly = true;
      this.endedBy = reqInfo;
      this.status = 'finished';
      this.touchActivity();
      return { immediatelyFinished: true, alreadyFinished: false, pending: false };
    }

    // status === 'playing': 标记本小局结束后结束整场游戏
    if (!this.endAfterCurrentRound) {
      this.endAfterCurrentRound = true;
      this.endRequestedBy = reqInfo;
    }
    this.touchActivity();
    return { immediatelyFinished: false, alreadyFinished: false, pending: true };
  }

  public cancelEndAfterRound(userId: number): void {
    if (this.status !== 'playing') {
      throw new Error('Can only cancel pending end during an active round');
    }
    if (!this.endAfterCurrentRound || this.endRequestedBy?.userId !== userId) {
      throw new Error('Only the requester can cancel the pending end request');
    }
    this.endAfterCurrentRound = false;
    this.endRequestedBy = undefined;
    this.touchActivity();
  }

  public addAiPlayer(difficulty: 'easy' | 'medium' | 'hard' | 'ultimate' = 'medium'): RoomPlayer {
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
    const aiNames: Record<'easy' | 'medium' | 'hard' | 'ultimate', string[]> = {
      easy: ['[AI·初级] 豆包牌友', '[AI·初级] 休闲阿宝', '[AI·初级] 萌新小卒'],
      medium: ['[AI·中级] 策略阿策', '[AI·中级] 稳健牌手', '[AI·中级] 算数张三'],
      hard: ['[AI·高级] 宗师破阵', '[AI·高级] 推演大师', '[AI·高级] 胜率弈手'],
      ultimate: ['[AI·终极] 宿命算圣', '[AI·终极] 阿尔法牌神', '[AI·终极] 奇点先知'],
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
    this.touchActivity();
    return aiPlayer;
  }

  public removeAiPlayer(seat: number): boolean {
    if (this.status !== 'waiting') {
      throw new Error('Cannot remove AI after game started');
    }
    const p = this.players.get(seat);
    if (p && p.isAi) {
      this.players.delete(seat);
      this.touchActivity();
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
    this.endAfterCurrentRound = false;
    this.endRequestedBy = undefined;
    this.endedEarly = false;
    this.endedBy = undefined;
    this.touchActivity();

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
    this.endAfterCurrentRound = false;
    this.endRequestedBy = undefined;
    this.touchActivity();

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

    if (this.endAfterCurrentRound) {
      this.status = 'finished';
      this.endedEarly = true;
      this.endedBy = this.endRequestedBy;
      this.endAfterCurrentRound = false;
      this.endRequestedBy = undefined;
    } else {
      this.status = this.currentRound >= this.totalRounds ? 'finished' : 'round_end';
    }
    this.touchActivity();

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
      endAfterCurrentRound: this.endAfterCurrentRound,
      endRequestedBy: this.endRequestedBy,
      endedEarly: this.endedEarly,
      endedBy: this.endedBy,
      players: Array.from(this.players.values()).map(p => ({
        seat: p.seat,
        userId: p.userId,
        username: p.username,
        isReady: p.isReady,
        isOnline: p.isOnline,
        hasLeft: Boolean(p.hasLeft),
        cumulativeScore: p.cumulativeScore,
        isAi: Boolean(p.isAi),
        aiDifficulty: p.aiDifficulty,
      })),
    };
  }
}

class RoomManager {
  private rooms: Map<string, GameRoom> = new Map();
  public waitingOfflineTtlMs = Number(process.env.WAITING_OFFLINE_TTL_MS || 60 * 60 * 1000);
  public activeOfflineTtlMs = Number(process.env.ACTIVE_OFFLINE_TTL_MS || 6 * 60 * 60 * 1000);
  public finishedOfflineTtlMs = Number(process.env.FINISHED_OFFLINE_TTL_MS || 60 * 60 * 1000);

  constructor() {
    // 启动定期巡检定时器：每 30 秒清理无人类玩家或超过离线保护期的闲置房间
    setInterval(() => {
      this.cleanupInactiveRooms();
    }, 30000).unref();
  }

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

  public deleteRoom(code: string): boolean {
    const upper = code.toUpperCase();
    return this.rooms.delete(upper);
  }

  public findRoomByUserId(userId: number, preferredCode?: string): GameRoom | undefined {
    this.cleanupInactiveRooms();

    const isUserActiveInRoom = (room: GameRoom) =>
      Array.from(room.players.values()).some(p => !p.isAi && !p.hasLeft && p.userId === userId);

    if (preferredCode) {
      const preferred = this.getRoom(preferredCode);
      if (preferred && isUserActiveInRoom(preferred)) {
        return preferred;
      }
    }

    const candidates = Array.from(this.rooms.values()).filter(isUserActiveInRoom);
    if (candidates.length === 0) return undefined;

    const priority: Record<GameRoom['status'], number> = {
      playing: 0,
      round_end: 1,
      waiting: 2,
      finished: 3,
    };
    candidates.sort((a, b) => priority[a.status] - priority[b.status]);
    return candidates[0];
  }

  // 核心清理：自动删除无人/纯AI房间，以及超过离线保留时限的房间
  public cleanupInactiveRooms(now: number = Date.now()): void {
    const opts: RoomExpirationOptions = {
      waitingOfflineTtlMs: this.waitingOfflineTtlMs,
      activeOfflineTtlMs: this.activeOfflineTtlMs,
      finishedOfflineTtlMs: this.finishedOfflineTtlMs,
    };
    for (const [code, room] of this.rooms.entries()) {
      if (room.isExpired(now, opts)) {
        console.log(`[RoomManager] Auto-deleted inactive/expired room: ${code}`);
        this.rooms.delete(code);
      }
    }
  }

  public listPublicRooms() {
    const now = Date.now();
    this.cleanupInactiveRooms(now);
    return Array.from(this.rooms.values())
      .filter(r => {
        if (r.status !== 'waiting' || r.isEmptyOrAllAi()) return false;
        if (r.getOnlineHumanPlayers().length > 0) return true;
        return r.allHumansOfflineSince !== undefined && now - r.allHumansOfflineSince < 120000;
      })
      .map(r => r.getPublicRoomInfo());
  }
}

export const roomManager = new RoomManager();
