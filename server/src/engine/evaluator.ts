// 宿命公牌 (Dora Hold'em) - 德州扑克标准牌型判定与宝牌判定引擎

import { Card, Rank, parseCard, RANK_VALUES } from './card.js';

export enum HandRank {
  HIGH_CARD = 1,
  ONE_PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
  ROYAL_FLUSH = 10,
}

export const HAND_RANK_KEYS: Record<HandRank, string> = {
  [HandRank.ROYAL_FLUSH]: 'pokerHands.royalFlush',
  [HandRank.STRAIGHT_FLUSH]: 'pokerHands.straightFlush',
  [HandRank.FOUR_OF_A_KIND]: 'pokerHands.fourOfAKind',
  [HandRank.FULL_HOUSE]: 'pokerHands.fullHouse',
  [HandRank.FLUSH]: 'pokerHands.flush',
  [HandRank.STRAIGHT]: 'pokerHands.straight',
  [HandRank.THREE_OF_A_KIND]: 'pokerHands.threeOfAKind',
  [HandRank.TWO_PAIR]: 'pokerHands.twoPair',
  [HandRank.ONE_PAIR]: 'pokerHands.onePair',
  [HandRank.HIGH_CARD]: 'pokerHands.highCard',
};

export interface Evaluated5CardHand {
  rank: HandRank;
  rankNameKey: string;
  best5Cards: Card[];
  tieBreakers: number[];
  doraCount: number;
}

/**
 * 评估恰好 5 张牌的牌型与强度
 */
export function evaluate5Cards(cards: Card[], legalDoraRank: Rank): Evaluated5CardHand {
  if (cards.length !== 5) {
    throw new Error('evaluate5Cards requires exactly 5 cards');
  }

  const parsed = cards.map(c => ({
    card: c,
    ...parseCard(c),
  }));

  // 按牌点大小降序排列
  parsed.sort((a, b) => b.value - a.value);

  // 统计花色与点数频次
  const suitCounts: Record<string, number> = {};
  const rankCounts: Map<number, number> = new Map();
  const rankCards: Map<number, Card[]> = new Map();

  for (const p of parsed) {
    suitCounts[p.suit] = (suitCounts[p.suit] || 0) + 1;
    rankCounts.set(p.value, (rankCounts.get(p.value) || 0) + 1);
    if (!rankCards.has(p.value)) {
      rankCards.set(p.value, []);
    }
    rankCards.get(p.value)!.push(p.card);
  }

  const isFlush = Object.values(suitCounts).some(cnt => cnt === 5);

  // 检查顺子
  let isStraight = false;
  let straightHigh = 0;

  const uniqueValues = Array.from(rankCounts.keys()).sort((a, b) => b - a);
  if (uniqueValues.length === 5) {
    // 普通顺子
    if (uniqueValues[0] - uniqueValues[4] === 4) {
      isStraight = true;
      straightHigh = uniqueValues[0];
    }
    // 特殊轮子顺 (A-2-3-4-5)
    else if (
      uniqueValues[0] === 14 && // A
      uniqueValues[1] === 5 &&
      uniqueValues[2] === 4 &&
      uniqueValues[3] === 3 &&
      uniqueValues[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5; // 此时最高按 5 计
    }
  }

  // 1. 同花顺 / 皇家同花顺
  if (isFlush && isStraight) {
    const isRoyal = straightHigh === 14;
    const rank = isRoyal ? HandRank.ROYAL_FLUSH : HandRank.STRAIGHT_FLUSH;
    return createEvalResult(rank, parsed.map(p => p.card), [straightHigh], legalDoraRank);
  }

  // 整理点数分组 (按数量降序，数量相同按点数降序)
  const groups: { val: number; count: number; cards: Card[] }[] = [];
  rankCounts.forEach((count, val) => {
    groups.push({ val, count, cards: rankCards.get(val)! });
  });
  groups.sort((a, b) => b.count - a.count || b.val - a.val);

  // 2. 四条 (Four of a Kind)
  if (groups[0].count === 4) {
    const orderedCards = [...groups[0].cards, ...groups[1].cards];
    return createEvalResult(
      HandRank.FOUR_OF_A_KIND,
      orderedCards,
      [groups[0].val, groups[1].val],
      legalDoraRank
    );
  }

  // 3. 葫芦 (Full House)
  if (groups[0].count === 3 && groups[1].count === 2) {
    const orderedCards = [...groups[0].cards, ...groups[1].cards];
    return createEvalResult(
      HandRank.FULL_HOUSE,
      orderedCards,
      [groups[0].val, groups[1].val],
      legalDoraRank
    );
  }

  // 4. 同花 (Flush)
  if (isFlush) {
    return createEvalResult(
      HandRank.FLUSH,
      parsed.map(p => p.card),
      parsed.map(p => p.value),
      legalDoraRank
    );
  }

  // 5. 顺子 (Straight)
  if (isStraight) {
    let orderedCards: Card[];
    if (straightHigh === 5 && uniqueValues[0] === 14) {
      // A-2-3-4-5 重新排序：5, 4, 3, 2, A
      orderedCards = [
        ...rankCards.get(5)!,
        ...rankCards.get(4)!,
        ...rankCards.get(3)!,
        ...rankCards.get(2)!,
        ...rankCards.get(14)!,
      ];
    } else {
      orderedCards = parsed.map(p => p.card);
    }
    return createEvalResult(HandRank.STRAIGHT, orderedCards, [straightHigh], legalDoraRank);
  }

  // 6. 三条 (Three of a Kind)
  if (groups[0].count === 3) {
    const orderedCards = [...groups[0].cards, ...groups[1].cards, ...groups[2].cards];
    return createEvalResult(
      HandRank.THREE_OF_A_KIND,
      orderedCards,
      [groups[0].val, groups[1].val, groups[2].val],
      legalDoraRank
    );
  }

  // 7. 两对 (Two Pair)
  if (groups[0].count === 2 && groups[1].count === 2) {
    const orderedCards = [...groups[0].cards, ...groups[1].cards, ...groups[2].cards];
    return createEvalResult(
      HandRank.TWO_PAIR,
      orderedCards,
      [groups[0].val, groups[1].val, groups[2].val],
      legalDoraRank
    );
  }

  // 8. 一对 (One Pair)
  if (groups[0].count === 2) {
    const orderedCards = [
      ...groups[0].cards,
      ...groups[1].cards,
      ...groups[2].cards,
      ...groups[3].cards,
    ];
    return createEvalResult(
      HandRank.ONE_PAIR,
      orderedCards,
      [groups[0].val, groups[1].val, groups[2].val, groups[3].val],
      legalDoraRank
    );
  }

  // 9. 高牌 (High Card)
  return createEvalResult(
    HandRank.HIGH_CARD,
    parsed.map(p => p.card),
    parsed.map(p => p.value),
    legalDoraRank
  );
}

function createEvalResult(
  rank: HandRank,
  best5Cards: Card[],
  tieBreakers: number[],
  legalDoraRank: Rank
): Evaluated5CardHand {
  const doraCount = best5Cards.filter(c => c[0] === legalDoraRank).length;
  return {
    rank,
    rankNameKey: HAND_RANK_KEYS[rank],
    best5Cards,
    tieBreakers,
    doraCount,
  };
}

/**
 * 比较两组 5 张牌的数学强弱
 * 返回: >0 表示 a > b; <0 表示 a < b; ===0 表示平局 (Tie)
 */
export function compare5CardHands(a: Evaluated5CardHand, b: Evaluated5CardHand): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  for (let i = 0; i < Math.max(a.tieBreakers.length, b.tieBreakers.length); i++) {
    const valA = a.tieBreakers[i] ?? 0;
    const valB = b.tieBreakers[i] ?? 0;
    if (valA !== valB) {
      return valA - valB;
    }
  }
  return 0; // 完全平局
}

/**
 * 寻找最佳 5 张牌组合（严格遵循客观绝对最大原则）
 * 从玩家的 5 张手牌与全场公共牌构成的候选牌池（cardsCount >= 6）中，
 * 遍历 C(N, 5) 种组合，寻找数学上最强的成牌。
 * 若存在数学上绝对并列第一的组合，则优先选择天然包含宝牌数最多的组合。
 */
export function findBestHand(
  holeCards: Card[],
  communityCards: Card[],
  legalDoraRank: Rank
): Evaluated5CardHand {
  const totalCards = [...holeCards, ...communityCards];
  if (totalCards.length < 5) {
    throw new Error('Total available cards must be at least 5');
  }
  if (totalCards.length === 5) {
    return evaluate5Cards(totalCards, legalDoraRank);
  }

  let bestHand: Evaluated5CardHand | null = null;

  // 组合生成算法 C(N, 5)
  function combine(start: number, chosen: Card[]) {
    if (chosen.length === 5) {
      const current = evaluate5Cards(chosen, legalDoraRank);
      if (!bestHand) {
        bestHand = current;
      } else {
        const cmp = compare5CardHands(current, bestHand);
        if (cmp > 0) {
          bestHand = current;
        } else if (cmp === 0) {
          // 数学绝对平局时，选择天然包含更多宝牌的组合
          if (current.doraCount > bestHand.doraCount) {
            bestHand = current;
          }
        }
      }
      return;
    }

    const remainingNeeded = 5 - chosen.length;
    for (let i = start; i <= totalCards.length - remainingNeeded; i++) {
      chosen.push(totalCards[i]);
      combine(i + 1, chosen);
      chosen.pop();
    }
  }

  combine(0, []);
  return bestHand!;
}

