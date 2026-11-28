// 宿命公牌 (Dora Hold'em) - 四级难度 AI 决策单元测试与延迟/实力基准测试

import { GameHandState } from './gameState.js';
import { executeAiDecision, AiDifficulty } from './ai.js';
import { getAiModel } from './neuralNet.js';
import { TurnActionType } from '../shared/types.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ AI TEST FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

console.log('--- 0. 验证神经网络权重与方案B蒸馏表加载 ---');
const model = getAiModel();
assert(model !== null, 'ai_weights.json 加载成功');
assert(model!.actorLayers.length === 3, 'Actor Policy Net (3层) 完整加载');
assert(model!.partialValueLayers.length === 3, 'Partial Value Net (3层) 完整加载');
assert(model!.godValueLayers.length === 3, 'God Critic Value Net (3层) 完整加载');
assert(Object.keys(model!.distilledTable).length > 10, '方案B规则蒸馏表已加载');

console.log('\n--- 1. 测试四级难度 AI 决策合法性与推理耗时 ---');
for (const difficulty of ['easy', 'medium', 'hard', 'ultimate'] as AiDifficulty[]) {
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
  game.currentTurnSeat = 2;

  const t0 = performance.now();
  const decision = executeAiDecision(game, 2, difficulty);
  const dt = performance.now() - t0;
  console.log(`[${difficulty.toUpperCase()}] Decision: ${decision.action} (${dt.toFixed(2)} ms)`);

  assert(Object.values(TurnActionType).includes(decision.action), `${difficulty} 必须返回有效 5 大行动之一`);
  if (difficulty === 'medium' || difficulty === 'hard') {
    assert(dt < 25, `${difficulty} 单步推理必须在轻量毫秒级内完成 (实测: ${dt.toFixed(2)}ms)`);
  }
  if (difficulty === 'ultimate') {
    assert(dt < 60, `ultimate (PIMC + 1步前瞻) 单步耗时应控制在极轻量范围 (实测: ${dt.toFixed(2)}ms)`);
  }

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

console.log('\n--- 2. 测试 Hard & Ultimate AI 持超强成牌理性决策 ---');
for (const diff of ['hard', 'ultimate'] as AiDifficulty[]) {
  const game = new GameHandState(
    `ROOM_${diff.toUpperCase()}_TEST`,
    1,
    4,
    1,
    [
      { seat: 1, userId: 101, username: 'Human' },
      { seat: 2, userId: -102, username: `AI_${diff}` },
    ]
  );
  const aiPlayer = game.players.get(2)!;
  game.currentTurnSeat = 2;
  game.legalDoraRank = 'A';
  aiPlayer.holeCards = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
  game.communityCards = ['2d', '3c', '4h'];
  game.currentOrbit = 2;

  const decision = executeAiDecision(game, 2, diff);
  assert(
    decision.action === TurnActionType.CALL_SHOWDOWN,
    `${diff} AI 持有皇家同花顺天王级牌力时必须坚决执行终结决战 (CALL_SHOWDOWN)`
  );
}

console.log('\n--- 3. 分人数实战对战实力测试: Ultimate / Hard 对阵 Easy (2P/3P/4P/5P) ---');
function playMatchSeries(heroDiff: AiDifficulty, oppDiff: AiDifficulty, hands: number, playerCount: number) {
  let heroTotal = 0;
  let totalHeroMs = 0;
  let heroDecisions = 0;
  for (let h = 0; h < hands; h++) {
    const dealer = (h % playerCount) + 1;
    const heroSeat = (h % playerCount) + 1;
    const players = Array.from({ length: playerCount }, (_, idx) => ({
      seat: idx + 1,
      userId: idx + 1,
      username: `P${idx + 1}`,
    }));
    const game = new GameHandState(
      `BENCH_${playerCount}P_${h}`,
      1,
      playerCount,
      dealer,
      players
    );
    let turns = 0;
    while (!game.isHandFinished && turns < 35) {
      turns++;
      const seat = game.currentTurnSeat;
      const diff = seat === heroSeat ? heroDiff : oppDiff;
      const t0 = performance.now();
      const d = executeAiDecision(game, seat, diff);
      if (seat === heroSeat) {
        totalHeroMs += performance.now() - t0;
        heroDecisions++;
      }
      switch (d.action) {
        case TurnActionType.DISCARD_DRAW:
          game.performDiscardDraw(seat, d.discardFaceUp!, d.discardFaceDown);
          break;
        case TurnActionType.MANIPULATE_SWAP:
          game.performSwap(seat, d.swappedHandCard!, d.swappedBoardCard!);
          break;
        case TurnActionType.MANIPULATE_BANISH:
          game.performBanish(seat, d.banishBoardCard!);
          break;
        case TurnActionType.EXPAND_BOARD:
          game.performExpandBoard(seat);
          break;
        case TurnActionType.FOLD:
          game.performFold(seat);
          break;
        case TurnActionType.CALL_SHOWDOWN:
          game.performCallShowdown(seat);
          break;
      }
      game.checkTurnStartConditions();
    }
    if (!game.isHandFinished) {
      game.performCallShowdown(game.currentTurnSeat);
    }
    const res = game.settlement!.playerResults.find(r => r.seat === heroSeat)!;
    heroTotal += res.scoreChange;
  }
  return {
    avgScore: heroTotal / hands,
    avgMs: totalHeroMs / Math.max(1, heroDecisions),
  };
}

let hardAllSum = 0;
let ultAllSum = 0;
for (const pc of [2, 3, 4, 5]) {
  const hRes = playMatchSeries('hard', 'easy', 40, pc);
  const uRes = playMatchSeries('ultimate', 'easy', 40, pc);
  hardAllSum += hRes.avgScore;
  ultAllSum += uRes.avgScore;
  console.log(
    `[${pc}P] Hard avg=${hRes.avgScore >= 0 ? '+' : ''}${hRes.avgScore.toFixed(2)} (${hRes.avgMs.toFixed(2)}ms) | ` +
    `Ultimate avg=${uRes.avgScore >= 0 ? '+' : ''}${uRes.avgScore.toFixed(2)} (${uRes.avgMs.toFixed(2)}ms)`
  );
  assert(hRes.avgMs < 5, `${pc}P Hard AI 平均单步耗时应 < 5ms (实测: ${hRes.avgMs.toFixed(2)} ms)`);
  assert(uRes.avgMs <= 20, `${pc}P Ultimate AI 平均单步耗时应 <= 20ms (实测: ${uRes.avgMs.toFixed(2)} ms)`);
}
assert(hardAllSum / 4 > 0, `Hard AI 跨人数平均收益必须为正 (实测: ${(hardAllSum / 4).toFixed(2)})`);
assert(ultAllSum / 4 > 0, `Ultimate AI 跨人数平均收益必须为正 (实测: ${(ultAllSum / 4).toFixed(2)})`);

console.log('\n🎉 ALL 4-TIER NEURAL + PIMC AI TESTS PASSED!\n');
