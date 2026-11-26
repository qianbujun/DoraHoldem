// 宿命公牌 (Dora Hold'em) - 四级难度 AI 决策引擎
// - easy:     初级 (休闲随机启发式)
// - medium:   中级 (方案A 策略网络 + 方案B 规则蒸馏先验, 0 搜索, ~0.2ms)
// - hard:     高级 (方案A 策略+局部估值网络 + 方案B 蒸馏阈值与置换增强, <1ms)
// - ultimate: 终极 (PIMC 行为加权平行世界采样 + 1步前瞻 + 上帝视角估值网络 + 方案B 先验, <=18ms)

import { Card, Rank, parseCard, createDeck } from './card.js';
import {
  findBestHand,
  compare5CardHands,
  HandRank,
  Evaluated5CardHand,
} from './evaluator.js';
import { TurnActionType } from '../shared/types.js';
import { PlayerRuntimeState, GameHandState } from './gameState.js';
import {
  ACT_BANISH_OFFSET,
  ACT_CALL_SHOWDOWN,
  ACT_DISCARD1_OFFSET,
  ACT_DISCARD2_OFFSET,
  ACT_EXPAND_BOARD,
  ACT_FOLD,
  ACT_SWAP_OFFSET,
  DISCARD2_PAIRS,
  MAX_BOARD_SLOTS,
  NUM_ACTIONS,
  SnapshotForEncoding,
  computeLegalActionMask,
  encodeActorObs,
  encodeCriticObs,
  forwardMLP,
  getAiModel,
  getDiscard2ActionId,
  getDistilledEntry,
  getSortedBoardCards,
  getSortedHoleCards,
  maskedSoftmax,
  sampleFromProbs,
  snapshotFromGame,
} from './neuralNet.js';

export type AiDifficulty = 'easy' | 'medium' | 'hard' | 'ultimate';

export interface AiDecision {
  action: TurnActionType;
  discardFaceUp?: Card;
  discardFaceDown?: Card;
  swappedHandCard?: Card;
  swappedBoardCard?: Card;
  banishBoardCard?: Card;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getSwappableHoleCards(player: PlayerRuntimeState): Card[] {
  return player.holeCards.filter(c => !player.exposedCards.includes(c));
}

function getKnownDeadCards(game: GameHandState, selfSeat: number): Set<Card> {
  const dead = new Set<Card>();
  const self = game.players.get(selfSeat)!;
  self.holeCards.forEach(c => dead.add(c));
  game.communityCards.forEach(c => dead.add(c));
  for (const p of game.players.values()) {
    p.exposedCards.forEach(c => dead.add(c));
    p.faceUpDiscards.forEach(c => dead.add(c));
  }
  return dead;
}

function actionIdToDecision(
  actionId: number,
  holeSorted: Card[],
  boardSorted: Card[]
): AiDecision {
  if (actionId === ACT_CALL_SHOWDOWN) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }
  if (actionId === ACT_FOLD) {
    return { action: TurnActionType.FOLD };
  }
  if (actionId === ACT_EXPAND_BOARD) {
    return { action: TurnActionType.EXPAND_BOARD };
  }
  if (actionId >= ACT_DISCARD1_OFFSET && actionId < ACT_DISCARD2_OFFSET) {
    const i = actionId - ACT_DISCARD1_OFFSET;
    return {
      action: TurnActionType.DISCARD_DRAW,
      discardFaceUp: holeSorted[i],
    };
  }
  if (actionId >= ACT_DISCARD2_OFFSET && actionId < ACT_SWAP_OFFSET) {
    const [i, j] = DISCARD2_PAIRS[actionId - ACT_DISCARD2_OFFSET];
    return {
      action: TurnActionType.DISCARD_DRAW,
      discardFaceUp: holeSorted[i],
      discardFaceDown: holeSorted[j],
    };
  }
  if (actionId >= ACT_SWAP_OFFSET && actionId < ACT_BANISH_OFFSET) {
    const rel = actionId - ACT_SWAP_OFFSET;
    const i = Math.floor(rel / MAX_BOARD_SLOTS);
    const b = rel % MAX_BOARD_SLOTS;
    return {
      action: TurnActionType.MANIPULATE_SWAP,
      swappedHandCard: holeSorted[i],
      swappedBoardCard: boardSorted[b],
    };
  }
  const b = actionId - ACT_BANISH_OFFSET;
  return {
    action: TurnActionType.MANIPULATE_BANISH,
    banishBoardCard: boardSorted[b],
  };
}

// ==========================================
// 1. 初级 AI (Easy / 休闲萌新 - 保留随机娱乐风格)
// ==========================================
function decideEasy(game: GameHandState, selfSeat: number): AiDecision {
  const self = game.players.get(selfSeat)!;
  const swappableCards = getSwappableHoleCards(self);
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);

  if (myEval.rank >= HandRank.TWO_PAIR && game.currentOrbit >= 2 && Math.random() < 0.6) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  const roll = Math.random();
  if (roll < 0.5 && game.drawPile.length >= 2 && self.holeCards.length >= 2) {
    const discard2 = Math.random() < 0.6;
    if (discard2) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: self.holeCards[0],
        discardFaceDown: self.holeCards[1],
      };
    }
    return {
      action: TurnActionType.DISCARD_DRAW,
      discardFaceUp: self.holeCards[0],
    };
  }

  if (roll >= 0.5 && roll < 0.7 && swappableCards.length > 0 && game.communityCards.length > 0) {
    return {
      action: TurnActionType.MANIPULATE_SWAP,
      swappedHandCard: pickRandom(swappableCards),
      swappedBoardCard: pickRandom(game.communityCards),
    };
  }

  if (roll >= 0.7 && roll < 0.85 && game.drawPile.length >= 1) {
    return { action: TurnActionType.EXPAND_BOARD };
  }

  if (roll >= 0.85 && roll < 0.95 && game.communityCards.length > 0 && game.drawPile.length >= 1) {
    return {
      action: TurnActionType.MANIPULATE_BANISH,
      banishBoardCard: pickRandom(game.communityCards),
    };
  }

  if (game.currentOrbit >= 4 && myEval.rank === HandRank.HIGH_CARD && Math.random() < 0.5) {
    return { action: TurnActionType.FOLD };
  }

  return { action: TurnActionType.CALL_SHOWDOWN };
}

// ==========================================
// 启发式保底（仅在权重缺失等极端情况下使用）
// ==========================================
function fallbackHeuristicDecision(game: GameHandState, selfSeat: number): AiDecision {
  const self = game.players.get(selfSeat)!;
  const swappable = getSwappableHoleCards(self);
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);

  if (myEval.rank >= HandRank.THREE_OF_A_KIND && game.currentOrbit >= 2) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }
  for (const bCard of game.communityCards) {
    for (const hCard of swappable) {
      const testHole = self.holeCards.filter(c => c !== hCard).concat([bCard]);
      const testEval = findBestHand(testHole, game.communityCards, game.legalDoraRank);
      if (compare5CardHands(testEval, myEval) > 0) {
        return {
          action: TurnActionType.MANIPULATE_SWAP,
          swappedHandCard: hCard,
          swappedBoardCard: bCard,
        };
      }
    }
  }
  if (game.drawPile.length >= 2 && self.holeCards.length >= 2) {
    const bestSet = new Set(myEval.best5Cards);
    const useless = self.holeCards.filter(c => !bestSet.has(c) && c[0] !== game.legalDoraRank);
    if (useless.length >= 2) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: useless[0],
        discardFaceDown: useless[1],
      };
    }
    if (useless.length === 1) {
      return {
        action: TurnActionType.DISCARD_DRAW,
        discardFaceUp: useless[0],
      };
    }
  }
  return { action: TurnActionType.CALL_SHOWDOWN };
}

// ==========================================
// 2. 中级 AI (Medium / 稳健策略 - 方案A策略网络 + 方案B规则蒸馏先验, 0搜索)
// ==========================================
function decideMedium(game: GameHandState, selfSeat: number): AiDecision {
  const model = getAiModel();
  if (!model || model.actorLayers.length === 0) {
    return fallbackHeuristicDecision(game, selfSeat);
  }

  const self = game.players.get(selfSeat)!;
  const holeSorted = getSortedHoleCards(self);
  const boardSorted = getSortedBoardCards(game.communityCards);
  const mask = computeLegalActionMask(game, selfSeat);
  const snap = snapshotFromGame(game);
  const obsActor = encodeActorObs(snap, selfSeat);
  const logits = Float32Array.from(forwardMLP(obsActor, model.actorLayers));

  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);
  const distilled = getDistilledEntry(model, myEval.rank, myEval.doraCount, game.currentOrbit);

  // 结合方案 B 蒸馏表做温和校准与防呆保护（不进行任何前瞻搜索）
  if (distilled) {
    if (myEval.rank <= HandRank.HIGH_CARD && game.currentOrbit === 1 && distilled.actionProbs.SHOWDOWN < 0.05) {
      logits[ACT_CALL_SHOWDOWN] -= 2.2;
    }
    if (distilled.winRate >= 0.62 && game.currentOrbit >= 2) {
      logits[ACT_CALL_SHOWDOWN] += 1.1;
    }
    if (distilled.winRate < 0.24 && game.currentOrbit >= 2 && distilled.avgReturn < -game.currentOrbit) {
      logits[ACT_FOLD] += 1.25;
    }
  }

  // 若是四条以上超强牌型且第 2 巡起，直接高概率开牌锁定胜局
  if (myEval.rank >= HandRank.FOUR_OF_A_KIND && game.currentOrbit >= 2) {
    logits[ACT_CALL_SHOWDOWN] += 3.5;
  }

  const probs = maskedSoftmax(logits, mask, 0.85);
  const chosenId = sampleFromProbs(probs);
  return actionIdToDecision(chosenId, holeSorted, boardSorted);
}

// ==========================================
// 3. 高级 AI (Hard / 战术宗师 - 方案A策略+估值网络 + 方案B蒸馏阈值与置换增强)
// ==========================================
function decideHard(game: GameHandState, selfSeat: number): AiDecision {
  const model = getAiModel();
  if (!model || model.actorLayers.length === 0) {
    return fallbackHeuristicDecision(game, selfSeat);
  }

  const self = game.players.get(selfSeat)!;
  const holeSorted = getSortedHoleCards(self);
  const boardSorted = getSortedBoardCards(game.communityCards);
  const exposedSet = new Set(self.exposedCards);
  const mask = computeLegalActionMask(game, selfSeat);
  const snap = snapshotFromGame(game);
  const obsActor = encodeActorObs(snap, selfSeat);

  const logits = Float32Array.from(forwardMLP(obsActor, model.actorLayers));
  const partialVal =
    model.partialValueLayers.length > 0
      ? forwardMLP(obsActor, model.partialValueLayers)[0] * model.rewardScale
      : 0;

  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);
  const distilled = getDistilledEntry(model, myEval.rank, myEval.doraCount, game.currentOrbit);

  // 1. 若手持极强成牌 (如皇家同花顺/同花顺/四条/葫芦等) 且满足局势要求，坚决决战开牌
  if (myEval.rank >= HandRank.STRAIGHT_FLUSH && game.currentOrbit >= 2) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }
  if (myEval.rank >= HandRank.FULL_HOUSE && game.currentOrbit >= 2) {
    logits[ACT_CALL_SHOWDOWN] += 3.2;
  }

  // 2. 结合方案 B 蒸馏胜率与 PartialValueNet 估值调整开牌 / 止损跑路倾角
  if (distilled) {
    if (distilled.winRate >= 0.60 && game.currentOrbit >= 2) {
      logits[ACT_CALL_SHOWDOWN] += 1.8;
    }
    if (myEval.rank === HandRank.HIGH_CARD && myEval.doraCount === 0 && partialVal < 0.2) {
      logits[ACT_CALL_SHOWDOWN] -= 2.8;
    }
    if (
      game.currentOrbit >= 2 &&
      partialVal < -game.currentOrbit - 0.6 &&
      distilled.winRate < 0.25
    ) {
      logits[ACT_FOLD] += 2.0;
    }
  }

  // 3. 确定性 1 步公私置换增强：精准抓出能直接升阶或净增宝牌的置换
  const nBoard = Math.min(boardSorted.length, MAX_BOARD_SLOTS);
  for (let b = 0; b < nBoard; b++) {
    const bCard = boardSorted[b];
    for (let i = 0; i < holeSorted.length; i++) {
      const hCard = holeSorted[i];
      if (exposedSet.has(hCard)) continue;
      const actId = ACT_SWAP_OFFSET + i * MAX_BOARD_SLOTS + b;
      if (!mask[actId]) continue;

      const tHole = holeSorted.filter(c => c !== hCard);
      tHole.push(bCard);
      const tBoard = boardSorted.map(c => (c === bCard ? hCard : c));
      const tEval = findBestHand(tHole, tBoard, game.legalDoraRank);
      const cmp = compare5CardHands(tEval, myEval);
      if (cmp > 0) {
        const rankGain = tEval.rank - myEval.rank;
        logits[actId] += 1.4 + rankGain * 0.9 + Math.max(0, tEval.doraCount - myEval.doraCount) * 0.8;
      } else if (cmp === 0 && tEval.doraCount > myEval.doraCount) {
        logits[actId] += 1.1;
      }
    }
  }

  // 低温精细采样 (T = 0.35)，兼顾强度与极小变招防被完全针对
  const probs = maskedSoftmax(logits, mask, 0.35);
  const chosenId = sampleFromProbs(probs);
  return actionIdToDecision(chosenId, holeSorted, boardSorted);
}

// ==========================================
// 4. 终极 AI (Ultimate / 宿命算圣)
//    PIMC (行为加权平行世界采样) + 1步前瞻 + 上帝视角估值网络 + 方案B先验
// ==========================================

function computeExactWorldShowdownPayoff(
  players: Map<number, PlayerRuntimeState>,
  communityCards: Card[],
  legalDoraRank: Rank,
  currentOrbit: number,
  currentPot: number,
  dealerSeat: number,
  playerCount: number,
  selfSeat: number
): number {
  const selfP = players.get(selfSeat)!;
  if (selfP.isFolded) {
    return -(selfP.foldOrbit ?? currentOrbit);
  }

  const active: Array<{ player: PlayerRuntimeState; evalHand: Evaluated5CardHand }> = [];
  for (const p of players.values()) {
    if (!p.isFolded && p.holeCards.length > 0 && p.holeCards.length + communityCards.length >= 5) {
      active.push({
        player: p,
        evalHand: findBestHand(p.holeCards, communityCards, legalDoraRank),
      });
    }
  }

  if (active.length <= 1) {
    return currentPot;
  }

  let bestEval = active[0].evalHand;
  for (let i = 1; i < active.length; i++) {
    if (compare5CardHands(active[i].evalHand, bestEval) > 0) {
      bestEval = active[i].evalHand;
    }
  }

  const winners = active.filter(a => compare5CardHands(a.evalHand, bestEval) === 0);
  const winnerSeats = new Set(winners.map(w => w.player.seat));
  const winnerDora = Math.max(...winners.map(w => w.evalHand.doraCount));
  const baseScore = communityCards.length + currentOrbit + winnerDora;
  const losersCount = active.length - winners.length;
  const totalPrize = losersCount * baseScore + currentPot;

  if (!winnerSeats.has(selfSeat)) {
    return -baseScore;
  }

  const share = Math.floor(totalPrize / winners.length);
  const rem = totalPrize % winners.length;
  let oddSeat: number | undefined;
  if (rem > 0) {
    for (let i = 0; i < playerCount; i++) {
      const s = ((dealerSeat - 1 + i) % playerCount) + 1;
      if (winnerSeats.has(s)) {
        oddSeat = s;
        break;
      }
    }
  }
  return share + (selfSeat === oddSeat ? rem : 0);
}

function advanceOrbitEstimate(
  players: Map<number, PlayerRuntimeState>,
  currentTurnSeat: number,
  dealerSeat: number,
  playerCount: number,
  currentOrbit: number
): number {
  let nextSeat = currentTurnSeat;
  let attempts = 0;
  do {
    nextSeat = (nextSeat % playerCount) + 1;
    attempts++;
    if (attempts > playerCount) return currentOrbit;
  } while (players.get(nextSeat)?.isFolded);
  return nextSeat === dealerSeat ? currentOrbit + 1 : currentOrbit;
}

function buildUltimateCandidateList(
  game: GameHandState,
  selfSeat: number,
  holeSorted: Card[],
  boardSorted: Card[],
  mask: Uint8Array,
  policyProbs: Float32Array
): number[] {
  const candidates = new Set<number>();

  // 1. 终局与加注类核心动作必选入候选题
  if (mask[ACT_CALL_SHOWDOWN]) candidates.add(ACT_CALL_SHOWDOWN);
  if (mask[ACT_FOLD]) candidates.add(ACT_FOLD);
  if (mask[ACT_EXPAND_BOARD]) candidates.add(ACT_EXPAND_BOARD);

  // 2. Top-3 弃牌换牌 (Strategy Prior)
  const discardRanked: Array<{ id: number; p: number }> = [];
  for (let id = ACT_DISCARD1_OFFSET; id < ACT_SWAP_OFFSET; id++) {
    if (mask[id]) discardRanked.push({ id, p: policyProbs[id] });
  }
  discardRanked.sort((a, b) => b.p - a.p);
  for (let k = 0; k < Math.min(3, discardRanked.length); k++) {
    candidates.add(discardRanked[k].id);
  }

  // 补充启发式最低贡献牌弃牌（防止极端情况漏选最优弃牌）
  const self = game.players.get(selfSeat)!;
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);
  const bestSet = new Set(myEval.best5Cards);
  const uselessSorted = holeSorted
    .map((c, idx) => ({ c, idx, val: parseCard(c).value }))
    .filter(item => !bestSet.has(item.c) && item.c[0] !== game.legalDoraRank)
    .sort((a, b) => a.val - b.val);
  if (uselessSorted.length >= 2) {
    const id2 = getDiscard2ActionId(uselessSorted[0].idx, uselessSorted[1].idx);
    if (id2 !== undefined && mask[id2]) candidates.add(id2);
  } else if (uselessSorted.length === 1) {
    const id1 = ACT_DISCARD1_OFFSET + uselessSorted[0].idx;
    if (mask[id1]) candidates.add(id1);
  }

  // 3. Top-2 公私置换 + 最佳提升 Swap
  const swapRanked: Array<{ id: number; p: number }> = [];
  for (let id = ACT_SWAP_OFFSET; id < ACT_BANISH_OFFSET; id++) {
    if (mask[id]) swapRanked.push({ id, p: policyProbs[id] });
  }
  swapRanked.sort((a, b) => b.p - a.p);
  for (let k = 0; k < Math.min(2, swapRanked.length); k++) {
    candidates.add(swapRanked[k].id);
  }

  const exposedSet = new Set(self.exposedCards);
  let bestSwapId: number | null = null;
  let bestSwapScore = 0;
  for (let b = 0; b < Math.min(boardSorted.length, MAX_BOARD_SLOTS); b++) {
    const bCard = boardSorted[b];
    for (let i = 0; i < holeSorted.length; i++) {
      const hCard = holeSorted[i];
      if (exposedSet.has(hCard)) continue;
      const actId = ACT_SWAP_OFFSET + i * MAX_BOARD_SLOTS + b;
      if (!mask[actId]) continue;
      const tHole = holeSorted.filter(c => c !== hCard);
      tHole.push(bCard);
      const tBoard = boardSorted.map(c => (c === bCard ? hCard : c));
      const tEval = findBestHand(tHole, tBoard, game.legalDoraRank);
      const cmp = compare5CardHands(tEval, myEval);
      if (cmp > 0 || (cmp === 0 && tEval.doraCount > myEval.doraCount)) {
        const s = tEval.rank * 100 + tEval.doraCount * 20 + (tEval.tieBreakers[0] ?? 0);
        if (s > bestSwapScore) {
          bestSwapScore = s;
          bestSwapId = actId;
        }
      }
    }
  }
  if (bestSwapId !== null) candidates.add(bestSwapId);

  // 4. Top-1 放逐刷新
  let bestBanishId = -1;
  let bestBanishP = -1;
  for (let id = ACT_BANISH_OFFSET; id < NUM_ACTIONS; id++) {
    if (mask[id] && policyProbs[id] > bestBanishP) {
      bestBanishP = policyProbs[id];
      bestBanishId = id;
    }
  }
  if (bestBanishId !== -1) candidates.add(bestBanishId);

  return Array.from(candidates);
}

function decideUltimate(game: GameHandState, selfSeat: number): AiDecision {
  const model = getAiModel();
  if (!model || model.actorLayers.length === 0 || model.godValueLayers.length === 0) {
    return decideHard(game, selfSeat);
  }

  const self = game.players.get(selfSeat)!;
  const holeSorted = getSortedHoleCards(self);
  const boardSorted = getSortedBoardCards(game.communityCards);
  const mask = computeLegalActionMask(game, selfSeat);
  const baseSnap = snapshotFromGame(game);
  const obsActor = encodeActorObs(baseSnap, selfSeat);

  const policyLogits = forwardMLP(obsActor, model.actorLayers);
  const policyProbs = maskedSoftmax(policyLogits, mask, 1.0);
  const myEval = findBestHand(self.holeCards, game.communityCards, game.legalDoraRank);

  // 必胜超强牌直接终结开牌
  if (myEval.rank >= HandRank.STRAIGHT_FLUSH && game.currentOrbit >= 2) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  const activeOpponents = Array.from(game.players.values()).filter(
    p => !p.isFolded && p.seat !== selfSeat
  );
  if (activeOpponents.length === 0) {
    return { action: TurnActionType.CALL_SHOWDOWN };
  }

  const shortlist = buildUltimateCandidateList(
    game,
    selfSeat,
    holeSorted,
    boardSorted,
    mask,
    policyProbs
  );

  const deadCards = getKnownDeadCards(game, selfSeat);
  const fullDeck = createDeck();
  const unseenCards = fullDeck.filter(c => !deadCards.has(c));

  const neededOppCards = activeOpponents.reduce(
    (acc, op) => acc + Math.max(0, 5 - op.exposedCards.length),
    0
  );
  if (unseenCards.length < neededOppCards + 2) {
    return decideHard(game, selfSeat);
  }

  const MAX_WORLDS = 36;
  const TIME_BUDGET_MS = 12.0;
  const startTime = performance.now();

  const weightedSums = new Float64Array(shortlist.length);
  let totalWeight = 0;

  // 缓存相同 (postHole, postBoard, orbit) 的 331 维 Actor 特征，避免在多世界采样中重复计算 Swap 扫描
  const actorObsCache = new Map<string, Float32Array>();

  // 预构造可复用的玩家映射，减少 PIMC 世界采样中的内存分配
  const worldPlayers = new Map<number, PlayerRuntimeState>();
  for (const p of game.players.values()) {
    worldPlayers.set(p.seat, {
      seat: p.seat,
      userId: p.userId,
      username: p.username,
      holeCards: [...p.holeCards],
      exposedCards: [...p.exposedCards],
      faceUpDiscards: [...p.faceUpDiscards],
      isFolded: p.isFolded,
      foldOrbit: p.foldOrbit,
      isDealer: p.isDealer,
      chipScore: p.chipScore,
    });
  }

  const shuffleBuf = [...unseenCards];
  const sampleNeeded = Math.min(shuffleBuf.length, neededOppCards + 2);

  for (let w = 0; w < MAX_WORLDS; w++) {
    if (w >= 4 && performance.now() - startTime >= TIME_BUDGET_MS) {
      break;
    }

    // Fisher-Yates 部分洗牌（只需前 sampleNeeded 张）
    for (let i = 0; i < sampleNeeded; i++) {
      const j = i + Math.floor(Math.random() * (shuffleBuf.length - i));
      const tmp = shuffleBuf[i];
      shuffleBuf[i] = shuffleBuf[j];
      shuffleBuf[j] = tmp;
    }

    let cursor = 0;
    let worldWeight = 1.0;

    // 按各对手公开明牌与行为逻辑构建平行世界手牌
    for (const op of activeOpponents) {
      const wp = worldPlayers.get(op.seat)!;
      const hiddenNeed = Math.max(0, 5 - op.exposedCards.length);
      wp.holeCards = [...op.exposedCards];
      for (let k = 0; k < hiddenNeed; k++) {
        wp.holeCards.push(shuffleBuf[cursor++]);
      }

      // 行为一致性加权（读牌）：高巡目未弃牌的对手极少持有无宝牌无听牌的纯垃圾高牌
      if (game.currentOrbit >= 2) {
        const oppEval = findBestHand(wp.holeCards, game.communityCards, game.legalDoraRank);
        if (oppEval.rank === HandRank.HIGH_CARD && oppEval.doraCount === 0) {
          worldWeight *= game.currentOrbit >= 3 ? 0.45 : 0.65;
        } else if (op.exposedCards.length > 0 && oppEval.rank >= HandRank.TWO_PAIR) {
          worldWeight *= 1.15;
        }
      }
    }

    const draw0 = shuffleBuf[cursor++];
    const draw1 = shuffleBuf[cursor++];
    totalWeight += worldWeight;

    const nextOrbit = advanceOrbitEstimate(
      worldPlayers,
      selfSeat,
      game.dealerSeat,
      game.playerCount,
      game.currentOrbit
    );

    const selfW = worldPlayers.get(selfSeat)!;

    for (let cIdx = 0; cIdx < shortlist.length; cIdx++) {
      const actId = shortlist[cIdx];

      if (actId === ACT_CALL_SHOWDOWN) {
        const exactPayoff = computeExactWorldShowdownPayoff(
          worldPlayers,
          game.communityCards,
          game.legalDoraRank,
          game.currentOrbit,
          game.currentPot,
          game.dealerSeat,
          game.playerCount,
          selfSeat
        );
        weightedSums[cIdx] += worldWeight * exactPayoff;
        continue;
      }

      if (actId === ACT_FOLD) {
        weightedSums[cIdx] += worldWeight * -game.currentOrbit;
        continue;
      }

      // 1 步前瞻推演后的局面状态
      let postHole = [...self.holeCards];
      let postExposed = [...self.exposedCards];
      let postFaceUpDiscards = [...self.faceUpDiscards];
      let postBoard = [...game.communityCards];
      let postDrawLen = game.drawPile.length;
      let postDiscardLen = game.discardPile.length;
      let postTopDraw: Card | undefined = draw1;

      if (actId === ACT_EXPAND_BOARD) {
        postBoard.push(draw0);
        postDrawLen = Math.max(0, postDrawLen - 1);
      } else if (actId >= ACT_DISCARD1_OFFSET && actId < ACT_DISCARD2_OFFSET) {
        const i = actId - ACT_DISCARD1_OFFSET;
        const up = holeSorted[i];
        postHole = postHole.filter(c => c !== up);
        postExposed = postExposed.filter(c => c !== up);
        postFaceUpDiscards.push(up);
        postHole.push(draw0);
        postDrawLen = Math.max(0, postDrawLen - 1);
      } else if (actId >= ACT_DISCARD2_OFFSET && actId < ACT_SWAP_OFFSET) {
        const [i, j] = DISCARD2_PAIRS[actId - ACT_DISCARD2_OFFSET];
        const up = holeSorted[i];
        const down = holeSorted[j];
        postHole = postHole.filter(c => c !== up && c !== down);
        postExposed = postExposed.filter(c => c !== up && c !== down);
        postFaceUpDiscards.push(up);
        postDiscardLen += 1;
        postHole.push(draw0, draw1);
        postDrawLen = Math.max(0, postDrawLen - 2);
        postTopDraw = undefined;
      } else if (actId >= ACT_SWAP_OFFSET && actId < ACT_BANISH_OFFSET) {
        const rel = actId - ACT_SWAP_OFFSET;
        const i = Math.floor(rel / MAX_BOARD_SLOTS);
        const b = rel % MAX_BOARD_SLOTS;
        const hCard = holeSorted[i];
        const bCard = boardSorted[b];
        postHole = postHole.filter(c => c !== hCard);
        postHole.push(bCard);
        postExposed.push(bCard);
        const bIdx = postBoard.indexOf(bCard);
        if (bIdx !== -1) postBoard[bIdx] = hCard;
        postTopDraw = draw0;
      } else if (actId >= ACT_BANISH_OFFSET) {
        const b = actId - ACT_BANISH_OFFSET;
        const bCard = boardSorted[b];
        const bIdx = postBoard.indexOf(bCard);
        if (bIdx !== -1) postBoard[bIdx] = draw0;
        postDiscardLen += 1;
        postDrawLen = Math.max(0, postDrawLen - 1);
      }

      // 更新自身状态到 worldPlayers 以评估 1 步后局面
      selfW.holeCards = postHole;
      selfW.exposedCards = postExposed;
      selfW.faceUpDiscards = postFaceUpDiscards;

      let stepVal: number;
      if (postDrawLen < 2) {
        // 触发摸空猝死 -> 精确计算开牌输赢
        stepVal = computeExactWorldShowdownPayoff(
          worldPlayers,
          postBoard,
          game.legalDoraRank,
          nextOrbit,
          game.currentPot,
          game.dealerSeat,
          game.playerCount,
          selfSeat
        );
      } else {
        const postSnap: SnapshotForEncoding = {
          playerCount: game.playerCount,
          dealerSeat: game.dealerSeat,
          currentOrbit: nextOrbit,
          legalDoraRank: game.legalDoraRank,
          communityCards: postBoard,
          drawPileLength: postDrawLen,
          discardPileLength: postDiscardLen,
          currentPot: game.currentPot,
          players: worldPlayers,
          topDrawCard: postTopDraw,
        };
        const cacheKey = `${postHole.join(',')}|${postExposed.join(',')}|${postBoard.join(',')}|${postDrawLen}`;
        let cachedActorObs = actorObsCache.get(cacheKey);
        if (!cachedActorObs) {
          cachedActorObs = encodeActorObs(postSnap, selfSeat);
          actorObsCache.set(cacheKey, cachedActorObs);
        }
        const obsGod = encodeCriticObs(postSnap, selfSeat, cachedActorObs);
        stepVal = forwardMLP(obsGod, model.godValueLayers)[0] * model.rewardScale;
      }

      weightedSums[cIdx] += worldWeight * stepVal;
    }
  }

  // 恢复 selfW 不影响外部，择优选择最高综合评分动作
  let bestActionId = shortlist[0];
  let bestCombinedScore = -Infinity;
  const distilled = getDistilledEntry(model, myEval.rank, myEval.doraCount, game.currentOrbit);

  for (let cIdx = 0; cIdx < shortlist.length; cIdx++) {
    const actId = shortlist[cIdx];
    const pimcEv = totalWeight > 0 ? weightedSums[cIdx] / totalWeight : 0;
    const priorBonus = 0.25 * Math.log(Math.max(policyProbs[actId], 1e-4));

    let distilledBonus = 0;
    if (distilled && actId === ACT_CALL_SHOWDOWN && distilled.winRate >= 0.65 && game.currentOrbit >= 2) {
      distilledBonus = 0.2;
    }

    const totalScore = pimcEv + priorBonus + distilledBonus;
    if (totalScore > bestCombinedScore) {
      bestCombinedScore = totalScore;
      bestActionId = actId;
    }
  }

  return actionIdToDecision(bestActionId, holeSorted, boardSorted);
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
    case 'ultimate':
      return decideUltimate(game, selfSeat);
    default:
      return decideMedium(game, selfSeat);
  }
}
