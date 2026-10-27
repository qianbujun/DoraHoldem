// 宿命公牌 (Dora Hold'em) - WebSocket 权威实时通信服务器

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { roomManager, GameRoom } from '../room/roomManager.js';
import { TurnActionType, GameEndReason } from '../shared/types.js';
import { Card } from '../engine/card.js';
import { executeAiDecision, AiDifficulty } from '../engine/ai.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dora_holdem_secret_key_2026';

interface ClientSession {
  ws: WebSocket;
  userId: number;
  username: string;
  roomCode?: string;
  seat?: number;
}

export class DoraWebSocketServer {
  private wss: WebSocketServer;
  private sessions: Map<WebSocket, ClientSession> = new Map();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.init();
  }

  private init() {
    this.wss.on('connection', (ws: WebSocket) => {
      const session: ClientSession = {
        ws,
        userId: 0,
        username: 'Guest',
      };
      this.sessions.set(ws, session);

      ws.on('message', async (data: string) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleMessage(session, msg);
        } catch (err: any) {
          this.sendError(ws, err.message || 'Malformed message');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(session);
        this.sessions.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[WS] Client error:', err);
      });
    });

    console.log('[WS] WebSocket server initialized on path /ws');
  }

  private async handleMessage(session: ClientSession, msg: { event: string; payload: any; token?: string }) {
    const { event, payload, token } = msg;

    // 身份认证（若有 token 自动更新 session）
    if (token) {
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        session.userId = decoded.userId;
        session.username = decoded.username;
      } catch (e) {
        // token 无效或过期忽略
      }
    }

    if (event === 'C2S_PING') {
      this.send(session.ws, 'S2C_PONG', { timestamp: Date.now() });
      return;
    }

    if (event === 'C2S_JOIN_ROOM') {
      await this.handleJoinRoom(session, payload);
      return;
    }

    const room = session.roomCode ? roomManager.getRoom(session.roomCode) : undefined;
    if (!room) {
      this.sendError(session.ws, 'Room not found or not in room');
      return;
    }

    switch (event) {
      case 'C2S_START_GAME':
        this.handleStartGame(room, session);
        break;

      case 'C2S_ADD_AI':
        this.handleAddAi(room, session, payload);
        break;

      case 'C2S_REMOVE_AI':
        this.handleRemoveAi(room, session, payload);
        break;

      case 'C2S_LEAVE_ROOM':
        this.handleLeaveRoom(room, session);
        break;

      case 'C2S_ACTION_DISCARD_DRAW':
        this.handleActionDiscardDraw(room, session, payload);
        break;

      case 'C2S_ACTION_SWAP':
        this.handleActionSwap(room, session, payload);
        break;

      case 'C2S_ACTION_BANISH':
        this.handleActionBanish(room, session, payload);
        break;

      case 'C2S_ACTION_EXPAND_BOARD':
        this.handleActionExpandBoard(room, session);
        break;

      case 'C2S_ACTION_FOLD':
        this.handleActionFold(room, session);
        break;

      case 'C2S_ACTION_CALL_SHOWDOWN':
        this.handleActionCallShowdown(room, session);
        break;

      case 'C2S_START_NEXT_ROUND':
        this.handleStartNextRound(room, session);
        break;

      default:
        this.sendError(session.ws, `Unknown event: ${event}`);
    }
  }

  private async handleJoinRoom(session: ClientSession, payload: { roomCode: string; password?: string; token?: string; targetSeat?: number }) {
    const room = roomManager.getRoom(payload.roomCode);
    if (!room) {
      this.sendError(session.ws, 'ROOM_NOT_FOUND');
      return;
    }

    if (room.password && room.password !== payload.password) {
      this.sendError(session.ws, 'INVALID_PASSWORD');
      return;
    }

    // 加入房间（支持玩家自选座位）
    const player = room.addPlayer(session.userId, session.username, payload.targetSeat);
    session.roomCode = room.code;
    session.seat = player.seat;

    // 广播房间信息更新
    this.broadcastToRoom(room.code, 'S2C_ROOM_UPDATE', room.getPublicRoomInfo());

    // 若当前正在对局中，给断线重连/刚进来的玩家补发公开牌面与自己手牌
    if (room.currentHand) {
      this.send(session.ws, 'S2C_GAME_STATE', room.currentHand.getPublicState());
      const privateState = room.currentHand.getPrivateStateForSeat(player.seat);
      if (privateState) {
        this.send(session.ws, 'S2C_PRIVATE_HOLE_CARDS', {
          mySeat: player.seat,
          holeCards: privateState.holeCards,
        });
      }
    }
  }

  private handleAddAi(room: GameRoom, session: ClientSession, payload: { difficulty?: AiDifficulty }) {
    if (session.userId !== room.ownerId) {
      this.sendError(session.ws, 'ONLY_OWNER_CAN_ADD_AI');
      return;
    }
    try {
      room.addAiPlayer(payload.difficulty || 'medium');
      this.broadcastToRoom(room.code, 'S2C_ROOM_UPDATE', room.getPublicRoomInfo());
    } catch (err: any) {
      this.sendError(session.ws, err.message);
    }
  }

  private handleRemoveAi(room: GameRoom, session: ClientSession, payload: { seat: number }) {
    if (session.userId !== room.ownerId) {
      this.sendError(session.ws, 'ONLY_OWNER_CAN_REMOVE_AI');
      return;
    }
    try {
      room.removeAiPlayer(payload.seat);
      this.broadcastToRoom(room.code, 'S2C_ROOM_UPDATE', room.getPublicRoomInfo());
    } catch (err: any) {
      this.sendError(session.ws, err.message);
    }
  }

  private handleStartGame(room: GameRoom, session: ClientSession) {
    if (session.userId !== room.ownerId) {
      this.sendError(session.ws, 'ONLY_OWNER_CAN_START');
      return;
    }

    try {
      const hand = room.startFirstRound();
      this.broadcastRoundStart(room, hand);
    } catch (err: any) {
      this.sendError(session.ws, err.message);
    }
  }

  private handleLeaveRoom(room: GameRoom, session: ClientSession) {
    room.removePlayer(session.userId);
    session.roomCode = undefined;
    session.seat = undefined;
    if (room.isEmptyOrAllAi()) {
      roomManager.deleteRoom(room.code);
    } else {
      this.broadcastToRoom(room.code, 'S2C_ROOM_UPDATE', room.getPublicRoomInfo());
    }
  }

  private handleStartNextRound(room: GameRoom, session: ClientSession) {
    if (session.userId !== room.ownerId && session.seat !== room.currentDealerSeat) {
      // 允许房主或当前庄家开下一局
    }

    try {
      const hand = room.startNextRound();
      this.broadcastRoundStart(room, hand);
    } catch (err: any) {
      if (room.status === 'finished') {
        this.broadcastToRoom(room.code, 'S2C_MATCH_FINISHED', room.getPublicRoomInfo());
      } else {
        this.sendError(session.ws, err.message);
      }
    }
  }

  private broadcastRoundStart(room: GameRoom, hand: any) {
    // 0. 同步全桌房间最新状态 (status 从 waiting 切换为 playing)
    this.broadcastToRoom(room.code, 'S2C_ROOM_UPDATE', room.getPublicRoomInfo());

    // 1. 全桌广播公开状态（暗牌以卡牌数量与掩码展示，公开首张公共牌作为法定宝牌）
    this.broadcastToRoom(room.code, 'S2C_ROUND_START', hand.getPublicState());

    // 2. 向每一位有座玩家单独私发其 5 张暗置底牌数据（严格防作弊）
    for (const s of this.sessions.values()) {
      if (s.roomCode === room.code && s.seat) {
        const privateState = hand.getPrivateStateForSeat(s.seat);
        if (privateState) {
          this.send(s.ws, 'S2C_PRIVATE_HOLE_CARDS', {
            mySeat: s.seat,
            holeCards: privateState.holeCards,
          });
        }
      }
    }

    // 3. 检查首轮庄家是否为 AI
    this.triggerAiTurnIfNeeded(room);
  }

  private handleActionDiscardDraw(
    room: GameRoom,
    session: ClientSession,
    payload: { discardFaceUp: Card; discardFaceDown?: Card }
  ) {
    const hand = room.currentHand;
    if (!hand || !session.seat) return;

    const { discardFaceUp, discardFaceDown } = payload;
    const { drawnCards } = hand.performDiscardDraw(session.seat, discardFaceUp, discardFaceDown);
    const player = room.players.get(session.seat);

    // 1. 全桌脱敏广播：公布明置弃牌面值；暗牌仅公布数量，完全不公布其点数与花色！
    this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
      actingSeat: session.seat,
      username: player?.username || `Seat ${session.seat}`,
      orbit: hand.currentOrbit,
      timestamp: Date.now(),
      actionType: TurnActionType.DISCARD_DRAW,
      details: {
        discardFaceUp,
        discardFaceDownCount: discardFaceDown ? 1 : 0,
        drawCount: drawnCards.length,
      },
      publicState: hand.getPublicState(),
    });

    // 2. 仅向行动者下发摸到的新底牌
    const privState = hand.getPrivateStateForSeat(session.seat)!;
    this.send(session.ws, 'S2C_PRIVATE_DRAW_RESULT', {
      drawnCards,
      currentHoleCards: privState.holeCards,
    });

    this.checkNextTurnEndConditions(room);
  }

  private handleActionSwap(
    room: GameRoom,
    session: ClientSession,
    payload: { handCard: Card; boardCard: Card }
  ) {
    const hand = room.currentHand;
    if (!hand || !session.seat) return;

    hand.performSwap(session.seat, payload.handCard, payload.boardCard);
    const player = room.players.get(session.seat);

    // 全桌广播：手牌换入公区，公牌换入玩家面前成为明置手牌
    this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
      actingSeat: session.seat,
      username: player?.username || `Seat ${session.seat}`,
      orbit: hand.currentOrbit,
      timestamp: Date.now(),
      actionType: TurnActionType.MANIPULATE_SWAP,
      details: {
        swappedHandCard: payload.handCard,
        swappedBoardCard: payload.boardCard,
      },
      publicState: hand.getPublicState(),
    });

    // 更新本人底牌快照
    const privState = hand.getPrivateStateForSeat(session.seat)!;
    this.send(session.ws, 'S2C_PRIVATE_HOLE_CARDS', {
      mySeat: session.seat,
      holeCards: privState.holeCards,
    });

    this.checkNextTurnEndConditions(room);
  }

  private handleActionBanish(
    room: GameRoom,
    session: ClientSession,
    payload: { boardCard: Card }
  ) {
    const hand = room.currentHand;
    if (!hand || !session.seat) return;

    const { refreshedCard } = hand.performBanish(session.seat, payload.boardCard);
    const player = room.players.get(session.seat);

    this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
      actingSeat: session.seat,
      username: player?.username || `Seat ${session.seat}`,
      orbit: hand.currentOrbit,
      timestamp: Date.now(),
      actionType: TurnActionType.MANIPULATE_BANISH,
      details: {
        banishedCard: payload.boardCard,
        refreshedCard,
      },
      publicState: hand.getPublicState(),
    });

    this.checkNextTurnEndConditions(room);
  }

  private handleActionExpandBoard(room: GameRoom, session: ClientSession) {
    const hand = room.currentHand;
    if (!hand || !session.seat) return;

    const { expandedCard } = hand.performExpandBoard(session.seat);
    const player = room.players.get(session.seat);

    this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
      actingSeat: session.seat,
      username: player?.username || `Seat ${session.seat}`,
      orbit: hand.currentOrbit,
      timestamp: Date.now(),
      actionType: TurnActionType.EXPAND_BOARD,
      details: {
        expandedCard,
      },
      publicState: hand.getPublicState(),
    });

    this.checkNextTurnEndConditions(room);
  }

  private async handleActionFold(room: GameRoom, session: ClientSession) {
    const hand = room.currentHand;
    if (!hand || !session.seat) return;

    const { foldCost, isLoneSurvivor } = hand.performFold(session.seat);
    const player = room.players.get(session.seat);

    this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
      actingSeat: session.seat,
      username: player?.username || `Seat ${session.seat}`,
      orbit: hand.currentOrbit,
      timestamp: Date.now(),
      actionType: TurnActionType.FOLD,
      details: {
        foldCost,
        isLoneSurvivor,
      },
      publicState: hand.getPublicState(),
    });

    if (isLoneSurvivor) {
      await this.finishHandAndBroadcast(room);
    } else {
      this.checkNextTurnEndConditions(room);
    }
  }

  private async handleActionCallShowdown(room: GameRoom, session: ClientSession) {
    const hand = room.currentHand;
    if (!hand || !session.seat) return;

    hand.performCallShowdown(session.seat);
    const player = room.players.get(session.seat);

    this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
      actingSeat: session.seat,
      username: player?.username || `Seat ${session.seat}`,
      orbit: hand.currentOrbit,
      timestamp: Date.now(),
      actionType: TurnActionType.CALL_SHOWDOWN,
      details: {},
      publicState: hand.getPublicState(),
    });

    await this.finishHandAndBroadcast(room);
  }

  private async checkNextTurnEndConditions(room: GameRoom) {
    const hand = room.currentHand;
    if (!hand) return;

    const check = hand.checkTurnStartConditions();
    if (check.shouldEnd) {
      // 摸空猝死触发终局比牌
      await this.finishHandAndBroadcast(room);
    } else {
      this.triggerAiTurnIfNeeded(room);
    }
  }

  private triggerAiTurnIfNeeded(room: GameRoom) {
    const hand = room.currentHand;
    if (!hand || hand.isHandFinished) return;

    const currentSeat = hand.currentTurnSeat;
    const player = room.players.get(currentSeat);
    if (!player || !player.isAi) return;

    // 延迟 2000ms (2s) 模拟 AI 人性化思考时间，方便玩家看清对局动态
    setTimeout(async () => {
      // 验证当前状态与席位一致性
      if (!room.currentHand || room.currentHand !== hand || hand.isHandFinished) return;
      if (hand.currentTurnSeat !== currentSeat) return;

      try {
        const difficulty = (player.aiDifficulty as AiDifficulty) || 'medium';
        const decision = executeAiDecision(hand, currentSeat, difficulty);

        switch (decision.action) {
          case TurnActionType.DISCARD_DRAW: {
            const { drawnCards } = hand.performDiscardDraw(
              currentSeat,
              decision.discardFaceUp!,
              decision.discardFaceDown
            );
            this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
              actingSeat: currentSeat,
              username: player.username,
              orbit: hand.currentOrbit,
              timestamp: Date.now(),
              actionType: TurnActionType.DISCARD_DRAW,
              details: {
                discardFaceUp: decision.discardFaceUp,
                discardFaceDownCount: decision.discardFaceDown ? 1 : 0,
                drawCount: drawnCards.length,
              },
              publicState: hand.getPublicState(),
            });
            this.checkNextTurnEndConditions(room);
            break;
          }

          case TurnActionType.MANIPULATE_SWAP: {
            hand.performSwap(currentSeat, decision.swappedHandCard!, decision.swappedBoardCard!);
            this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
              actingSeat: currentSeat,
              username: player.username,
              orbit: hand.currentOrbit,
              timestamp: Date.now(),
              actionType: TurnActionType.MANIPULATE_SWAP,
              details: {
                swappedHandCard: decision.swappedHandCard,
                swappedBoardCard: decision.swappedBoardCard,
              },
              publicState: hand.getPublicState(),
            });
            this.checkNextTurnEndConditions(room);
            break;
          }

          case TurnActionType.MANIPULATE_BANISH: {
            const { refreshedCard } = hand.performBanish(currentSeat, decision.banishBoardCard!);
            this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
              actingSeat: currentSeat,
              username: player.username,
              orbit: hand.currentOrbit,
              timestamp: Date.now(),
              actionType: TurnActionType.MANIPULATE_BANISH,
              details: {
                banishedCard: decision.banishBoardCard,
                refreshedCard,
              },
              publicState: hand.getPublicState(),
            });
            this.checkNextTurnEndConditions(room);
            break;
          }

          case TurnActionType.EXPAND_BOARD: {
            const { expandedCard } = hand.performExpandBoard(currentSeat);
            this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
              actingSeat: currentSeat,
              username: player.username,
              orbit: hand.currentOrbit,
              timestamp: Date.now(),
              actionType: TurnActionType.EXPAND_BOARD,
              details: {
                expandedCard,
              },
              publicState: hand.getPublicState(),
            });
            this.checkNextTurnEndConditions(room);
            break;
          }

          case TurnActionType.FOLD: {
            const { foldCost, isLoneSurvivor } = hand.performFold(currentSeat);
            this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
              actingSeat: currentSeat,
              username: player.username,
              orbit: hand.currentOrbit,
              timestamp: Date.now(),
              actionType: TurnActionType.FOLD,
              details: {
                foldCost,
                isLoneSurvivor,
              },
              publicState: hand.getPublicState(),
            });
            if (isLoneSurvivor) {
              await this.finishHandAndBroadcast(room);
            } else {
              this.checkNextTurnEndConditions(room);
            }
            break;
          }

          case TurnActionType.CALL_SHOWDOWN: {
            hand.performCallShowdown(currentSeat);
            this.broadcastToRoom(room.code, 'S2C_ACTION_EVENT', {
              actingSeat: currentSeat,
              username: player.username,
              orbit: hand.currentOrbit,
              timestamp: Date.now(),
              actionType: TurnActionType.CALL_SHOWDOWN,
              details: {},
              publicState: hand.getPublicState(),
            });
            await this.finishHandAndBroadcast(room);
            break;
          }
        }
      } catch (err) {
        console.error('[AI] Action execution error:', err);
      }
    }, 2000);
  }

  private async finishHandAndBroadcast(room: GameRoom) {
    const settlement = await room.finishCurrentHand();
    this.broadcastToRoom(room.code, 'S2C_SHOWDOWN_RESULT', {
      settlement,
      roomInfo: room.getPublicRoomInfo(),
    });
  }

  private handleDisconnect(session: ClientSession) {
    if (session.roomCode) {
      const room = roomManager.getRoom(session.roomCode);
      if (room) {
        room.removePlayer(session.userId);
        if (room.isEmptyOrAllAi()) {
          roomManager.deleteRoom(room.code);
        } else {
          this.broadcastToRoom(room.code, 'S2C_ROOM_UPDATE', room.getPublicRoomInfo());
        }
      }
    }
  }

  private broadcastToRoom(roomCode: string, event: string, payload: any) {
    const data = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const s of this.sessions.values()) {
      if (s.roomCode === roomCode && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(data);
      }
    }
  }

  private send(ws: WebSocket, event: string, payload: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, payload, timestamp: Date.now() }));
    }
  }

  private sendError(ws: WebSocket, message: string) {
    this.send(ws, 'S2C_ERROR', { message });
  }
}
