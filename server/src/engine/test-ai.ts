// 宿命公牌 (Dora Hold'em) - AI 三级难度决策单元测试

import { GameHandState } from './gameState.js';
import { executeAiDecision, AiDifficulty } from './ai.js';
import { TurnActionType } from '../shared/types.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ AI TEST FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

console.log('--- 1. 测试 AI 决策合法性与边界防护 ---');

for (const difficulty of ['easy', 'medium', 'hard'] as AiDifficulty[]) {
  const game = new GameHandState(
    'ROOM_AI_TEST',
    1,
    4,
    1,
    [
      { seat: 1, userId: 101, username: 'Human' },
      { seat: 2, userId: -102, username: `AI_${difficulty}` },
      { seat: 3, userId: -103, username: `AI_2` },
      { seat: 4, userId: -104, username: `AI_3` },
    ]
  );

  const aiPlayer = game.players.get(2)!;
  game.currentTurnSeat = 2; // AI 回合

  const decision = executeAiDecision(game, 2, difficulty);
  console.log(`[${difficulty.toUpperCase()}] Decision:`, decision.action);

  assert(Object.values(TurnActionType).includes(decision.action), `${difficulty} 必须返回有效 5 大行动之一`);

  if (decision.action === TurnActionType.DISCARD_DRAW) {
    assert(aiPlayer.holeCards.includes(decision.discardFaceUp!), `${difficulty} 弃置明牌必须在自身手牌中`);
    if (decision.discardFaceDown) {
      assert(aiPlayer.holeCards.includes(decision.discardFaceDown), `${difficulty} 弃置暗牌必须在自身手牌中`);
      assert(decision.discardFaceUp !== decision.discardFaceDown, `${difficulty} 明暗弃牌不能为同张牌`);
    }
  } else if (decision.action === TurnActionType.MANIPULATE_SWAP) {
    assert(aiPlayer.holeCards.includes(decision.swappedHandCard!), `${difficulty} 置换手牌必须在自身手牌中`);
    assert(!aiPlayer.exposedCards.includes(decision.swappedHandCard!), `${difficulty} 不可换出已明置手牌`);
    assert(game.communityCards.includes(decision.swappedBoardCard!), `${difficulty} 置换公牌必须在公区中`);
  } else if (decision.action === TurnActionType.MANIPULATE_BANISH) {
    assert(game.communityCards.includes(decision.banishBoardCard!), `${difficulty} 放逐公牌必须在公区中`);
  }
}

console.log('\n--- 2. 测试 Hard AI 胜率分析与理性行为 ---');
{
  const game = new GameHandState(
    'ROOM_HARD_TEST',
    1,
    4,
    1,
    [
      { seat: 1, userId: 101, username: 'Human' },
      { seat: 2, userId: -102, username: 'AI_Hard' },
    ]
  );
  const aiPlayer = game.players.get(2)!;
  game.currentTurnSeat = 2;
  game.legalDoraRank = 'A';
  // 给 Hard AI 一副皇家同花顺
  aiPlayer.holeCards = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
  game.communityCards = ['2d', '3c', '4h'];
  game.currentOrbit = 2;

  const decision = executeAiDecision(game, 2, 'hard');
  assert(
    decision.action === TurnActionType.CALL_SHOWDOWN,
    'Hard AI 持有皇家同花顺天王级牌力时必须坚决执行终结决战 (CALL_SHOWDOWN)'
  );
}

console.log('\n🎉 ALL AI DECISION ENGINE TESTS PASSED!\n');

