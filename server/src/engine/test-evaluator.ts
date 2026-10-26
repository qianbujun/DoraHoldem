// 宿命公牌 (Dora Hold'em) - 核心裁判与牌型测试套件

import { Card, Rank } from './card.js';
import {
  evaluate5Cards,
  findBestHand,
  compare5CardHands,
  HandRank,
} from './evaluator.js';
import { GameHandState } from './gameState.js';
import { GameEndReason } from '../shared/types.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

console.log('--- 1. 测试标准德州扑克牌型与轮子顺 (A-2-3-4-5) ---');
{
  const wheelHand = evaluate5Cards(['As', '2h', '3d', '4c', '5s'], '7');
  assert(wheelHand.rank === HandRank.STRAIGHT, 'A-2-3-4-5 必须判定为顺子');
  assert(wheelHand.tieBreakers[0] === 5, 'A-2-3-4-5 的顺子最高牌必须判定为 5');

  const royalFlush = evaluate5Cards(['As', 'Ks', 'Qs', 'Js', 'Ts'], 'A');
  assert(royalFlush.rank === HandRank.ROYAL_FLUSH, '同花 A-K-Q-J-T 判定为皇家同花顺');
  assert(royalFlush.doraCount === 1, '包含1张宝牌A');

  const fourOfAKind = evaluate5Cards(['9s', '9c', '9h', '9d', 'Kh'], '9');
  assert(fourOfAKind.rank === HandRank.FOUR_OF_A_KIND, '四条9判定');
  assert(fourOfAKind.doraCount === 4, '四条9包含4张宝牌9');
}

console.log('\n--- 2. 测试【最佳牌型客观原则】(客观最优禁止为了蹭宝牌而降级) ---');
{
  // 规则.md FAQ 判例：
  // 某玩家客观最大成牌为【A-A-Q-10-9】（对A带9踢脚）
  // 公牌有一张宝牌 2。玩家【不能】为了加1分而将踢脚9换成宝牌2
  const holeCards: Card[] = ['As', 'Ah', 'Qd', 'Ts', '2c'];
  const communityCards: Card[] = ['9h']; // 候选池: As, Ah, Qd, Ts, 9h, 2c (6选5)
  const legalDora: Rank = '2';

  const bestHand = findBestHand(holeCards, communityCards, legalDora);
  assert(bestHand.rank === HandRank.ONE_PAIR, '牌型必须是一对A');
  assert(
    bestHand.best5Cards.includes('9h') && !bestHand.best5Cards.includes('2c'),
    '根据客观绝对最大原则，踢脚必须是9h，严禁降级为宝牌2c'
  );
  assert(bestHand.doraCount === 0, '宝牌未被编入客观最强成牌，不计宝牌分');
}

console.log('\n--- 3. 严格验证《规则.md》第七章标准结算速查示例 ---');
{
  // 规则速查示例：
  // 4人对局 (A为庄家，B、C、D为闲家)
  // 法定宝牌：9
  // 第1巡：C 跑路，向底池交出 1 分
  // 第2巡：公牌共有 3 张。A 终结决战开牌！
  // A(庄家): 三条带一张宝牌9，胜出
  // B、D: 牌力较小，在场输家
  // 基础分 = 3 (公牌) + 2 (巡目) + 1 (A成牌中的宝牌9) = 6分
  // 在场输家赔付：B付6分，D付6分
  // A独占收益：收取 B(6) + D(6) + C跑路(1) = 13分

  const game = new GameHandState(
    'ROOM_TEST',
    1,
    4,
    1, // Seat 1 (A) 是庄家
    [
      { seat: 1, userId: 101, username: 'A' },
      { seat: 2, userId: 102, username: 'B' },
      { seat: 3, userId: 103, username: 'C' },
      { seat: 4, userId: 104, username: 'D' },
    ]
  );

  // 手工对齐测试场景参数
  game.legalDoraRank = '9';
  game.communityCards = ['9d', 'Kd', '2c']; // 3张公牌
  game.currentOrbit = 1;

  // A 手牌: 三条8 + 宝牌9d (在公牌) -> 成牌三条8带9
  const playerA = game.players.get(1)!;
  playerA.holeCards = ['8s', '8c', '8h', '4h', '3s'];

  // B 手牌: 一对J
  const playerB = game.players.get(2)!;
  playerB.holeCards = ['Js', 'Jc', '3d', '5s', '6h'];

  // D 手牌: 对2 (弱于三条)
  const playerD = game.players.get(4)!;
  playerD.holeCards = ['2s', '4d', '6d', '7h', 'Tc'];

  // C 跑路 (第1巡)
  game.currentTurnSeat = 3;
  game.performFold(3);
  assert(game.currentPot === 1, 'C第1巡跑路底池必须为1');

  // 进入第2巡
  game.currentOrbit = 2;
  game.currentTurnSeat = 1;

  // A 宣告终结决战
  const settlement = game.performCallShowdown(1);

  assert(settlement.baseScore === 6, `基础分必须为6 (实测: ${settlement.baseScore})`);
  assert(settlement.winnerSeats.includes(1), 'A必须是独占胜者');

  const resA = settlement.playerResults.find(r => r.seat === 1)!;
  const resB = settlement.playerResults.find(r => r.seat === 2)!;
  const resC = settlement.playerResults.find(r => r.seat === 3)!;
  const resD = settlement.playerResults.find(r => r.seat === 4)!;

  assert(resA.scoreChange === 13, `A的得分必须为+13 (实测: ${resA.scoreChange})`);
  assert(resB.scoreChange === -6, `B的赔付必须为-6 (实测: ${resB.scoreChange})`);
  assert(resC.scoreChange === -1, `C的跑路扣分必须为-1 (实测: ${resC.scoreChange})`);
  assert(resD.scoreChange === -6, `D的赔付必须为-6 (实测: ${resD.scoreChange})`);

  // 筹码零和守恒验证
  const netSum = resA.scoreChange + resB.scoreChange + resC.scoreChange + resD.scoreChange;
  assert(netSum === 0, `全场筹码总和必须严格为 0 (零和守恒，实测: ${netSum})`);
}

console.log('\n--- 4. 摸空猝死 (Deck Depletion) 测试 ---');
{
  const game = new GameHandState(
    'ROOM_SUDDEN_DEATH',
    1,
    4,
    1,
    [
      { seat: 1, userId: 101, username: 'A' },
      { seat: 2, userId: 102, username: 'B' },
    ]
  );
  game.drawPile = ['As']; // 仅剩 1 张（< 2 张）
  const check = game.checkTurnStartConditions();
  assert(check.shouldEnd === true, '牌堆不足2张必须触发终局');
  assert(check.reason === GameEndReason.DECK_DEPLETED, '终局原因必须为摸空猝死');
}

console.log('\n🎉 ALL POKER ENGINE TESTS PASSED PERFECTLY!\n');
