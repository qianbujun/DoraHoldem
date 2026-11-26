// 宿命公牌 (Dora Hold'em) - WebSocket 心跳、刷新/断线重连恢复与任意玩家提前结束整场测试

import http from 'http';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { DoraWebSocketServer } from '../websocket/server.js';
import { roomManager } from '../room/roomManager.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dora_holdem_secret_key_2026';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ RESILIENCE TEST FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

interface WsMsg {
  event: string;
  payload: any;
  timestamp?: number;
}

class TestWsClient {
  public ws: WebSocket;
  public messages: WsMsg[] = [];
  private waiters: Array<{ predicate: (m: WsMsg) => boolean; resolve: (m: WsMsg) => void; reject: (e: Error) => void }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', raw => {
      const msg: WsMsg = JSON.parse(raw.toString());
      this.messages.push(msg);
      const remaining: typeof this.waiters = [];
      for (const w of this.waiters) {
        if (w.predicate(msg)) {
          w.resolve(msg);
        } else {
          remaining.push(w);
        }
      }
      this.waiters = remaining;
    });
  }

  public async waitForOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', err => reject(err));
    });
  }

  public send(event: string, payload: any, token?: string) {
    this.ws.send(JSON.stringify({ event, payload, token }));
  }

  public waitForEvent(eventName: string, timeoutMs = 3000, predicate?: (m: WsMsg) => boolean): Promise<WsMsg> {
    const check = (m: WsMsg) => m.event === eventName && (!predicate || predicate(m));
    const existing = this.messages.find(check);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for event ${eventName}`));
      }, timeoutMs);
      this.waiters.push({
        predicate: check,
        resolve: msg => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  public clearMessages() {
    this.messages = [];
  }

  public async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

async function runResilienceTests() {
  const httpServer = http.createServer();
  const wsServer = new DoraWebSocketServer(httpServer, { heartbeatIntervalMs: 60000 });

  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as { port: number };
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

  const tokenP1 = jwt.sign({ userId: 5001, username: 'AliceHost' }, JWT_SECRET, { expiresIn: '1h' });
  const tokenP2 = jwt.sign({ userId: 5002, username: 'BobGuest' }, JWT_SECRET, { expiresIn: '1h' });
  const tokenP3 = jwt.sign({ userId: 5003, username: 'Outsider' }, JWT_SECRET, { expiresIn: '1h' });

  try {
    console.log('--- 1. 测试心跳 PING/PONG 与等待房间刷新不断线解散 ---');
    const soloRoom = roomManager.createRoom(5001, 2, 2);
    const c1 = new TestWsClient(wsUrl);
    await c1.waitForOpen();
    c1.send('C2S_JOIN_ROOM', { roomCode: soloRoom.code }, tokenP1);
    await c1.waitForEvent('S2C_ROOM_UPDATE');

    c1.send('C2S_PING', { timestamp: Date.now() }, tokenP1);
    const pong = await c1.waitForEvent('S2C_PONG');
    assert(Boolean(pong.payload.timestamp), '收到心跳 S2C_PONG 响应');

    // 模拟唯一人类刷新网页（断开连接），房间不应被解散
    await c1.close();
    await new Promise(r => setTimeout(r, 50));
    roomManager.cleanupInactiveRooms();
    assert(roomManager.getRoom(soloRoom.code) !== undefined, '唯一人类刷新/断线后等待房间不被解散');

    const c1Reconnected = new TestWsClient(wsUrl);
    await c1Reconnected.waitForOpen();
    c1Reconnected.send('C2S_AUTH', {}, tokenP1);
    const authRes1 = await c1Reconnected.waitForEvent('S2C_AUTH_RESULT');
    assert(authRes1.payload.restoredRoomCode === soloRoom.code, '刷新重连后自动恢复原等待房间');
    const roomUpdate1 = await c1Reconnected.waitForEvent('S2C_ROOM_UPDATE');
    assert(roomUpdate1.payload.players[0].isOnline === true, '重连后玩家恢复在线状态');

    // 添加 1 个 AI 并开局
    c1Reconnected.send('C2S_ADD_AI', { difficulty: 'easy' }, tokenP1);
    await c1Reconnected.waitForEvent('S2C_ROOM_UPDATE', 3000, m => m.payload.playerCount === 2);
    c1Reconnected.send('C2S_START_GAME', {}, tokenP1);
    await c1Reconnected.waitForEvent('S2C_ROUND_START');
    const holeMsg1 = await c1Reconnected.waitForEvent('S2C_PRIVATE_HOLE_CARDS');
    const originalHoleCards = [...holeMsg1.payload.holeCards];
    assert(originalHoleCards.length === 5, '开局收到 5 张私有底牌');

    // 人类玩家执行一次弃牌换牌（产生包含暗弃牌的行动日志）
    c1Reconnected.clearMessages();
    c1Reconnected.send(
      'C2S_ACTION_DISCARD_DRAW',
      { discardFaceUp: originalHoleCards[0], discardFaceDown: originalHoleCards[1] },
      tokenP1
    );
    const drawRes = await c1Reconnected.waitForEvent('S2C_PRIVATE_DRAW_RESULT');
    const updatedHoleCards = [...drawRes.payload.currentHoleCards];

    console.log('\n--- 2. 测试对局中刷新网页/暂离重连恢复手牌与脱敏战报 ---');
    // 模拟重连期间先开新连接再关旧连接的竞争场景（快速刷新）
    const c1TabNew = new TestWsClient(wsUrl);
    await c1TabNew.waitForOpen();
    c1TabNew.send('C2S_AUTH', {}, tokenP1);
    const authRes2 = await c1TabNew.waitForEvent('S2C_AUTH_RESULT');
    assert(authRes2.payload.restoredRoomCode === soloRoom.code, '对局中刷新后自动找回进行中的房间');
    const restoredHole = await c1TabNew.waitForEvent('S2C_PRIVATE_HOLE_CARDS');
    assert(
      JSON.stringify(restoredHole.payload.holeCards) === JSON.stringify(updatedHoleCards),
      '刷新后准确恢复当前最新 5 张底牌'
    );
    const syncedLogs = await c1TabNew.waitForEvent('S2C_SYNC_ACTION_LOGS');
    assert(
      syncedLogs.payload.logs.length >= 1 &&
        syncedLogs.payload.logs[0].details.discardFaceDown === undefined &&
        syncedLogs.payload.logs[0].details.drawnCards === undefined,
      '同步当前手牌行动记录且严格脱敏隐藏暗弃/摸牌面值'
    );

    // 旧连接此时才关闭，不应把新连接标记为离线
    await c1Reconnected.close();
    await new Promise(r => setTimeout(r, 50));
    assert(
      soloRoom.getOnlineHumanPlayers().length === 1,
      '旧连接迟延关闭不得把已重连的玩家误标为离线'
    );

    // 局外人尝试直接 C2S_JOIN_ROOM 加入已开局房间应被拒绝
    const outsider = new TestWsClient(wsUrl);
    await outsider.waitForOpen();
    outsider.send('C2S_JOIN_ROOM', { roomCode: soloRoom.code }, tokenP3);
    const errMsg = await outsider.waitForEvent('S2C_ERROR');
    assert(errMsg.payload.message === 'Game already started', '局外人仍不可中途加入已开局房间');
    await outsider.close();

    // 显式退出房间后不再恢复，且无人人类时房间清理
    c1TabNew.send('C2S_LEAVE_ROOM', {}, tokenP1);
    await new Promise(r => setTimeout(r, 50));
    assert(roomManager.getRoom(soloRoom.code) === undefined, '显式退出房间后无人房间应清理删除');
    c1TabNew.clearMessages();
    c1TabNew.send('C2S_AUTH', {}, tokenP1);
    const authAfterLeave = await c1TabNew.waitForEvent('S2C_AUTH_RESULT');
    assert(authAfterLeave.payload.restoredRoomCode === null, '显式退出后刷新不再回到已退出房间');
    await c1TabNew.close();

    console.log('\n--- 3. 测试任意玩家决定：本小回合结束后结束整场游戏 (playing 阶段) ---');
    const matchRoom = roomManager.createRoom(5001, 2, 4); // 2人 4局
    const host = new TestWsClient(wsUrl);
    const guest = new TestWsClient(wsUrl);
    await Promise.all([host.waitForOpen(), guest.waitForOpen()]);

    host.send('C2S_JOIN_ROOM', { roomCode: matchRoom.code }, tokenP1);
    await host.waitForEvent('S2C_ROOM_UPDATE');
    guest.send('C2S_JOIN_ROOM', { roomCode: matchRoom.code }, tokenP2);
    await guest.waitForEvent('S2C_ROOM_UPDATE', 3000, m => m.payload.playerCount === 2);

    host.send('C2S_START_GAME', {}, tokenP1);
    await Promise.all([host.waitForEvent('S2C_ROUND_START'), guest.waitForEvent('S2C_ROUND_START')]);

    // 客座玩家（非房主！）决定在本小回合结束后结束游戏
    host.clearMessages();
    guest.clearMessages();
    guest.send('C2S_REQUEST_END_GAME', {}, tokenP2);
    const [hostEndNotice, guestEndNotice] = await Promise.all([
      host.waitForEvent('S2C_ROOM_UPDATE', 3000, m => m.payload.endAfterCurrentRound === true),
      guest.waitForEvent('S2C_ROOM_UPDATE', 3000, m => m.payload.endAfterCurrentRound === true),
    ]);
    assert(
      hostEndNotice.payload.status === 'playing' &&
        hostEndNotice.payload.endRequestedBy?.userId === 5002 &&
        guestEndNotice.payload.endAfterCurrentRound === true,
      '客座玩家发起“本局后结束”后，当前小局继续进行并全桌同步提示'
    );

    // 非发起人不可撤销，发起人可撤销再重发
    host.clearMessages();
    host.send('C2S_CANCEL_END_GAME', {}, tokenP1);
    const cancelErr = await host.waitForEvent('S2C_ERROR');
    assert(Boolean(cancelErr.payload.message), '非发起人不可撤销他人的结束决定');

    guest.clearMessages();
    guest.send('C2S_CANCEL_END_GAME', {}, tokenP2);
    const cancelledUpdate = await guest.waitForEvent(
      'S2C_ROOM_UPDATE',
      3000,
      m => m.payload.endAfterCurrentRound === false
    );
    assert(cancelledUpdate.payload.endAfterCurrentRound === false, '发起人可在本局结束前撤销请求');

    guest.clearMessages();
    guest.send('C2S_REQUEST_END_GAME', {}, tokenP2);
    await guest.waitForEvent('S2C_ROOM_UPDATE', 3000, m => m.payload.endAfterCurrentRound === true);

    // 庄家（Host）执行终结决战结束本小回合
    host.clearMessages();
    guest.clearMessages();
    host.send('C2S_ACTION_CALL_SHOWDOWN', {}, tokenP1);
    const [hostShowdown, guestShowdown] = await Promise.all([
      host.waitForEvent('S2C_SHOWDOWN_RESULT'),
      guest.waitForEvent('S2C_SHOWDOWN_RESULT'),
    ]);
    assert(
      hostShowdown.payload.roomInfo.status === 'finished' &&
        hostShowdown.payload.roomInfo.endedEarly === true &&
        hostShowdown.payload.roomInfo.endedBy?.userId === 5002 &&
        guestShowdown.payload.roomInfo.currentRound === 1,
      '第 1 小回合结束后立即按约定结束整场游戏并标记 endedEarly'
    );

    // 此时若刷新网页，仍可恢复结算与终局排行
    await guest.close();
    const guestRefreshed = new TestWsClient(wsUrl);
    await guestRefreshed.waitForOpen();
    guestRefreshed.send('C2S_AUTH', {}, tokenP2);
    const guestSettlementSync = await guestRefreshed.waitForEvent('S2C_SHOWDOWN_RESULT');
    const guestMatchFin = await guestRefreshed.waitForEvent('S2C_MATCH_FINISHED');
    assert(
      Boolean(guestSettlementSync.payload.settlement) && guestMatchFin.payload.status === 'finished',
      '终局状态刷新重连后完整恢复末局结算与总榜'
    );

    await host.close();
    await guestRefreshed.close();
    roomManager.deleteRoom(matchRoom.code);

    console.log('\n--- 4. 测试 round_end（小回合刚结束）时任意玩家直接结束整场游戏 ---');
    const roundEndRoom = roomManager.createRoom(5001, 2, 4);
    const h2 = new TestWsClient(wsUrl);
    const g2 = new TestWsClient(wsUrl);
    await Promise.all([h2.waitForOpen(), g2.waitForOpen()]);
    h2.send('C2S_JOIN_ROOM', { roomCode: roundEndRoom.code }, tokenP1);
    await h2.waitForEvent('S2C_ROOM_UPDATE');
    g2.send('C2S_JOIN_ROOM', { roomCode: roundEndRoom.code }, tokenP2);
    await g2.waitForEvent('S2C_ROOM_UPDATE', 3000, m => m.payload.playerCount === 2);
    h2.send('C2S_START_GAME', {}, tokenP1);
    await Promise.all([h2.waitForEvent('S2C_ROUND_START'), g2.waitForEvent('S2C_ROUND_START')]);

    h2.send('C2S_ACTION_CALL_SHOWDOWN', {}, tokenP1);
    const s1 = await h2.waitForEvent('S2C_SHOWDOWN_RESULT');
    assert(s1.payload.roomInfo.status === 'round_end', '未请求结束时小局打完进入 round_end');

    // 在 round_end 状态刷新一次，校验状态不回退为 playing
    await g2.close();
    const g2Re = new TestWsClient(wsUrl);
    await g2Re.waitForOpen();
    g2Re.send('C2S_AUTH', {}, tokenP2);
    const g2Room = await g2Re.waitForEvent('S2C_ROOM_UPDATE');
    const g2Showdown = await g2Re.waitForEvent('S2C_SHOWDOWN_RESULT');
    assert(
      g2Room.payload.status === 'round_end' && Boolean(g2Showdown.payload.settlement),
      'round_end 阶段刷新重连准确恢复结算弹窗与 round_end 状态'
    );

    // 在 round_end 阶段客座玩家点击结束游戏
    h2.clearMessages();
    g2Re.clearMessages();
    g2Re.send('C2S_REQUEST_END_GAME', {}, tokenP2);
    const [h2Fin, g2Fin] = await Promise.all([
      h2.waitForEvent('S2C_MATCH_FINISHED'),
      g2Re.waitForEvent('S2C_MATCH_FINISHED'),
    ]);
    assert(
      h2Fin.payload.status === 'finished' &&
        h2Fin.payload.endedEarly === true &&
        g2Fin.payload.endedBy?.userId === 5002,
      'round_end 阶段任意玩家可立即结束整场游戏并广播终局总榜'
    );

    await h2.close();
    await g2Re.close();
    roomManager.deleteRoom(roundEndRoom.code);

    console.log('\n--- 5. 测试全员离线超过 TTL 后房间才会被自动清理 ---');
    const ttlRoom = roomManager.createRoom(5001, 2, 2);
    ttlRoom.addPlayer(5001, 'AliceHost');
    ttlRoom.addAiPlayer('easy');
    ttlRoom.startFirstRound();
    ttlRoom.markPlayerOffline(5001);
    const now = Date.now();
    roomManager.cleanupInactiveRooms(now + 60 * 60 * 1000); // 1 小时仍在 6 小时保护期内
    assert(roomManager.getRoom(ttlRoom.code) !== undefined, '对局中全员暂离 1 小时仍保留房间');
    roomManager.cleanupInactiveRooms(now + 7 * 60 * 60 * 1000); // 超过 6 小时后过期清理
    assert(roomManager.getRoom(ttlRoom.code) === undefined, '全员离线超过保护期上限后自动清理释放资源');

    console.log('\n🎉 ALL RESILIENCE, HEARTBEAT, RECONNECT & EARLY-END TESTS PASSED!\n');
  } finally {
    wsServer.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  }
}

runResilienceTests().catch(err => {
  console.error(err);
  process.exit(1);
});
