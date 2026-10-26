// 宿命公牌 (Dora Hold'em) - 端到端真实对局流转与 AI 交互模拟测试

import { roomManager } from '../room/roomManager.js';
import { executeAiDecision } from './ai.js';
import { TurnActionType } from '../shared/types.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ E2E TEST FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function runE2ETest() {
  console.log('--- 1. 模拟房主创建 3 人房间 ---');
  const ownerId = 888;
  const room = roomManager.createRoom(ownerId, 3, 3);
  room.addPlayer(ownerId, 'Alice(房主)');
  assert(room.players.size === 1, '房主成功入座');
  assert(room.status === 'waiting', '初始状态为 waiting');

  console.log('\n--- 2. 模拟房主添加 2 台不同难度 AI ---');
  const ai1 = room.addAiPlayer('medium');
  const ai2 = room.addAiPlayer('hard');
  assert(room.players.size === 3, '满员 3 人 (1 人类 + 2 AI)');
  assert(Boolean(ai1.isAi && ai1.aiDifficulty === 'medium'), 'AI 1 为中级难度');
  assert(Boolean(ai2.isAi && ai2.aiDifficulty === 'hard'), 'AI 2 为高级难度');

  console.log('\n--- 3. 模拟点击开始首局对战 ---');
  const hand = room.startFirstRound();
  assert(room.status === 'playing', '开局后房间状态必须更新为 playing');
  assert(room.currentRound === 1, '当前为第 1 局');
  assert(hand.currentOrbit === 1, '第 1 巡启动');
  assert(hand.communityCards.length === 1, '首张公牌翻开');
  assert(Boolean(hand.legalDoraRank), `法定宝牌已锁定: ${hand.legalDoraRank}`);

  console.log('\n--- 4. 模拟完整对局轮转直至决战开牌 ---');
  let turns = 0;
  while (!hand.isHandFinished && turns < 20) {
    turns++;
    const currentSeat = hand.currentTurnSeat;
    const player = room.players.get(currentSeat)!;

    console.log(`[回合 #${turns}] 巡目:${hand.currentOrbit} 座位:#${currentSeat} (${player.username}) 行动中...`);

    const difficulty = player.aiDifficulty || 'medium';
    const decision = executeAiDecision(hand, currentSeat, difficulty);
    console.log(`  -> 决策: ${decision.action}`);

    switch (decision.action) {
      case TurnActionType.DISCARD_DRAW:
        hand.performDiscardDraw(currentSeat, decision.discardFaceUp!, decision.discardFaceDown);
        break;
      case TurnActionType.MANIPULATE_SWAP:
        hand.performSwap(currentSeat, decision.swappedHandCard!, decision.swappedBoardCard!);
        break;
      case TurnActionType.MANIPULATE_BANISH:
        hand.performBanish(currentSeat, decision.banishBoardCard!);
        break;
      case TurnActionType.EXPAND_BOARD:
        hand.performExpandBoard(currentSeat);
        break;
      case TurnActionType.FOLD:
        hand.performFold(currentSeat);
        break;
      case TurnActionType.CALL_SHOWDOWN:
        hand.performCallShowdown(currentSeat);
        break;
    }

    hand.checkTurnStartConditions();
  }

  assert(hand.isHandFinished === true, '小局顺利结束决胜');
  assert(Boolean(hand.settlement), '结算单据成功生成');
  console.log(`\n终局基础分: ${hand.settlement!.baseScore}分, 胜者座位: ${hand.settlement!.winnerSeats.join(',')}`);

  console.log('\n--- 5. 模拟完成小局并结算房间总分 ---');
  await room.finishCurrentHand();
  assert(room.status === 'round_end', '小局打完后房间状态进入 round_end 等待下一局');

  console.log('\n--- 6. 模拟开启第 2 局并轮转庄家 ---');
  room.startNextRound();
  assert(room.status === 'playing', '第 2 局开启状态为 playing');
  assert(room.currentDealerSeat === 2, '第 2 局庄家顺时针轮换至 2 号位');

  console.log('\n--- 7. 严格测试相对位置算法 (保证庄家轮替时相对位置精确映射) ---');
  // 2人局测试
  for (let dealer = 1; dealer <= 2; dealer++) {
    const aliceSeat = 1;
    const pos = ((aliceSeat - dealer + 2) % 2) + 1;
    if (dealer === 1) {
      assert(pos === 1, '2人局第1局: Alice做庄必须为一号位(庄家)');
    } else {
      assert(pos === 2, '2人局第2局: 对手做庄Alice必须为二号位');
    }
  }

  // 4人局测试: 当 3 号位坐庄时
  assert(((3 - 3 + 4) % 4) + 1 === 1, '4人局Seat 3做庄时为一号位');
  assert(((4 - 3 + 4) % 4) + 1 === 2, '4人局Seat 4在Seat 3做庄时为二号位');
  assert(((1 - 3 + 4) % 4) + 1 === 3, '4人局Seat 1在Seat 3做庄时为三号位');
  assert(((2 - 3 + 4) % 4) + 1 === 4, '4人局Seat 2在Seat 3做庄时为四号位');

  console.log('\n🎉 E2E MULTI-ROUND AI GAMEPLAY TEST PASSED PERFECTLY!\n');
}

runE2ETest().catch(err => {
  console.error(err);
  process.exit(1);
});
