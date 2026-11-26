// 宿命公牌 (Dora Hold'em) - 零框架纯矩阵前向传播推理与特征工程模块 (Scheme A + Scheme B)
// 所有卡牌编号、特征维度 (331 / 571)、动作空间 (76) 严格与 ai_training/dora_sim.py 一致

import fs from 'fs';
import path from 'path';
import { Card, Rank, RANKS, SUITS, parseCard } from './card.js';
import { findBestHand, compare5CardHands, Evaluated5CardHand } from './evaluator.js';
import { GameHandState, PlayerRuntimeState } from './gameState.js';

export const MAX_HOLE_SLOTS = 5;
export const MAX_BOARD_SLOTS = 8;

export const ACT_CALL_SHOWDOWN = 0;
export const ACT_FOLD = 1;
export const ACT_EXPAND_BOARD = 2;
export const ACT_DISCARD1_OFFSET = 3;
export const ACT_DISCARD2_OFFSET = 8;
export const ACT_SWAP_OFFSET = 28;
export const ACT_BANISH_OFFSET = 68;
export const NUM_ACTIONS = 76;

export const OBS_ACTOR_DIM = 331;
export const OBS_GOD_EXTRA_DIM = 240;
export const OBS_CRITIC_DIM = OBS_ACTOR_DIM + OBS_GOD_EXTRA_DIM; // 571

export const DISCARD2_PAIRS: ReadonlyArray<readonly [number, number]> = (() => {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < MAX_HOLE_SLOTS; i++) {
    for (let j = 0; j < MAX_HOLE_SLOTS; j++) {
      if (i !== j) pairs.push([i, j]);
    }
  }
  return pairs;
})();

const DISCARD2_LOOKUP = new Map<string, number>(
  DISCARD2_PAIRS.map(([i, j], idx) => [`${i},${j}`, ACT_DISCARD2_OFFSET + idx])
);

export function getDiscard2ActionId(i: number, j: number): number | undefined {
  return DISCARD2_LOOKUP.get(`${i},${j}`);
}

const RANK_INDEX: Record<Rank, number> = {
  '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6,
  '9': 7, 'T': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12,
};

const SUIT_INDEX: Record<string, number> = { s: 0, h: 1, c: 2, d: 3 };

export function cardToId(card: Card): number {
  const r = RANK_INDEX[card[0] as Rank];
  const s = SUIT_INDEX[card[1]];
  return r * 4 + s;
}

export function idToCard(id: number): Card {
  const r = RANKS[Math.floor(id / 4)];
  const s = SUITS[id % 4];
  return `${r}${s}` as Card;
}

export interface CompiledLayer {
  inDim: number;
  outDim: number;
  w: Float32Array;
  b: Float32Array;
}

export interface DistilledStateEntry {
  count: number;
  avgReturn: number;
  winRate: number;
  actionProbs: {
    SHOWDOWN: number;
    FOLD: number;
    EXPAND: number;
    DISCARD: number;
    SWAP: number;
    BANISH: number;
  };
}

export interface LoadedAiModel {
  rewardScale: number;
  actorLayers: CompiledLayer[];
  partialValueLayers: CompiledLayer[];
  godValueLayers: CompiledLayer[];
  distilledTable: Record<string, DistilledStateEntry>;
}

interface RawLayerJson {
  in: number;
  out: number;
  w: number[];
  b: number[];
}

function compileLayers(raw: RawLayerJson[]): CompiledLayer[] {
  return raw.map(l => ({
    inDim: l.in,
    outDim: l.out,
    w: Float32Array.from(l.w),
    b: Float32Array.from(l.b),
  }));
}

function resolveWeightsPath(): string | null {
  const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.join(baseDir, 'ai_weights.json'),
    path.resolve(baseDir, '../../src/engine/ai_weights.json'),
    path.resolve(process.cwd(), 'src/engine/ai_weights.json'),
    path.resolve(process.cwd(), 'server/src/engine/ai_weights.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let cachedModel: LoadedAiModel | null | undefined = undefined;

export function getAiModel(): LoadedAiModel | null {
  if (cachedModel !== undefined) return cachedModel;
  const weightsPath = resolveWeightsPath();
  if (!weightsPath) {
    console.warn('[AI-NN] ai_weights.json not found, falling back to heuristic mode.');
    cachedModel = null;
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(weightsPath, 'utf-8'));
    cachedModel = {
      rewardScale: Number(raw.rewardScale) || 10.0,
      actorLayers: compileLayers(raw.actorLayers || []),
      partialValueLayers: compileLayers(raw.partialValueLayers || []),
      godValueLayers: compileLayers(raw.godValueLayers || []),
      distilledTable: raw.distilledRules?.stateTable || {},
    };
    return cachedModel;
  } catch (err) {
    console.error('[AI-NN] Failed to load ai_weights.json:', err);
    cachedModel = null;
    return null;
  }
}

export function forwardMLP(input: Float32Array, layers: CompiledLayer[]): Float32Array {
  let cur = input;
  for (let l = 0; l < layers.length; l++) {
    const { inDim, outDim, w, b } = layers[l];
    const out = new Float32Array(outDim);
    const isLast = l === layers.length - 1;
    for (let i = 0; i < outDim; i++) {
      let sum = b[i];
      const rowOffset = i * inDim;
      for (let j = 0; j < inDim; j++) {
        sum += w[rowOffset + j] * cur[j];
      }
      out[i] = isLast ? sum : sum > 0 ? sum : 0;
    }
    cur = out;
  }
  return cur;
}

export function maskedSoftmax(logits: Float32Array, mask: Uint8Array, temperature: number = 1.0): Float32Array {
  const probs = new Float32Array(logits.length);
  const temp = Math.max(temperature, 1e-4);
  let maxVal = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (mask[i]) {
      const v = logits[i] / temp;
      if (v > maxVal) maxVal = v;
    }
  }
  if (!Number.isFinite(maxVal)) return probs;
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    if (mask[i]) {
      const e = Math.exp(logits[i] / temp - maxVal);
      probs[i] = e;
      sum += e;
    }
  }
  if (sum > 0) {
    for (let i = 0; i < probs.length; i++) {
      probs[i] /= sum;
    }
  }
  return probs;
}

export function sampleFromProbs(probs: Float32Array): number {
  let r = Math.random();
  let lastValid = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > 0) {
      lastValid = i;
      r -= probs[i];
      if (r <= 0) return i;
    }
  }
  return lastValid;
}

export function getSortedHoleCards(player: PlayerRuntimeState): Card[] {
  return [...player.holeCards].sort((a, b) => cardToId(a) - cardToId(b));
}

export function getSortedBoardCards(communityCards: Card[]): Card[] {
  return [...communityCards].sort((a, b) => cardToId(a) - cardToId(b));
}

export function computeLegalActionMask(
  game: Pick<GameHandState, 'isHandFinished' | 'currentTurnSeat' | 'players' | 'communityCards' | 'drawPile'>,
  selfSeat: number
): Uint8Array {
  const mask = new Uint8Array(NUM_ACTIONS);
  if (game.isHandFinished || game.currentTurnSeat !== selfSeat) return mask;
  const self = game.players.get(selfSeat);
  if (!self || self.isFolded) return mask;

  mask[ACT_CALL_SHOWDOWN] = 1;
  mask[ACT_FOLD] = 1;
  if (game.drawPile.length >= 1) {
    mask[ACT_EXPAND_BOARD] = 1;
  }

  const hole = getSortedHoleCards(self);
  const board = getSortedBoardCards(game.communityCards);
  const exposedSet = new Set(self.exposedCards);
  const nHole = Math.min(hole.length, MAX_HOLE_SLOTS);
  const nBoard = Math.min(board.length, MAX_BOARD_SLOTS);

  if (game.drawPile.length >= 1) {
    for (let i = 0; i < nHole; i++) {
      mask[ACT_DISCARD1_OFFSET + i] = 1;
    }
  }

  if (game.drawPile.length >= 2 && nHole >= 2) {
    for (let idx = 0; idx < DISCARD2_PAIRS.length; idx++) {
      const [i, j] = DISCARD2_PAIRS[idx];
      if (i < nHole && j < nHole) {
        mask[ACT_DISCARD2_OFFSET + idx] = 1;
      }
    }
  }

  for (let i = 0; i < nHole; i++) {
    if (!exposedSet.has(hole[i])) {
      for (let b = 0; b < nBoard; b++) {
        mask[ACT_SWAP_OFFSET + i * MAX_BOARD_SLOTS + b] = 1;
      }
    }
  }

  if (game.drawPile.length >= 1) {
    for (let b = 0; b < nBoard; b++) {
      mask[ACT_BANISH_OFFSET + b] = 1;
    }
  }

  return mask;
}

function has4FlushDraw(cards: Card[]): number {
  const counts = [0, 0, 0, 0];
  for (const c of cards) {
    counts[SUIT_INDEX[c[1]]] += 1;
  }
  return Math.max(...counts) >= 4 ? 1 : 0;
}

function has4StraightDraw(cards: Card[]): number {
  const present = new Uint8Array(15);
  for (const c of cards) {
    const val = parseCard(c).value;
    present[val] = 1;
    if (val === 14) present[1] = 1;
  }
  for (let start = 1; start <= 10; start++) {
    let cnt = 0;
    for (let k = 0; k < 5; k++) cnt += present[start + k];
    if (cnt >= 4) return 1;
  }
  return 0;
}

export interface SnapshotForEncoding {
  playerCount: number;
  dealerSeat: number;
  currentOrbit: number;
  legalDoraRank: Rank;
  communityCards: Card[];
  drawPileLength: number;
  discardPileLength: number;
  currentPot: number;
  players: Map<number, PlayerRuntimeState>;
  topDrawCard?: Card;
}

export function snapshotFromGame(game: GameHandState): SnapshotForEncoding {
  return {
    playerCount: game.playerCount,
    dealerSeat: game.dealerSeat,
    currentOrbit: game.currentOrbit,
    legalDoraRank: game.legalDoraRank,
    communityCards: game.communityCards,
    drawPileLength: game.drawPile.length,
    discardPileLength: game.discardPile.length,
    currentPot: game.currentPot,
    players: game.players,
    topDrawCard: game.drawPile[0],
  };
}

export function encodeActorObs(snap: SnapshotForEncoding, selfSeat: number): Float32Array {
  const feats = new Float32Array(OBS_ACTOR_DIM);
  const selfP = snap.players.get(selfSeat)!;
  const holeSorted = getSortedHoleCards(selfP);
  const boardSorted = getSortedBoardCards(snap.communityCards);
  const exposedSet = new Set(selfP.exposedCards);

  for (const c of holeSorted) {
    const cid = cardToId(c);
    if (exposedSet.has(c)) {
      feats[52 + cid] = 1.0;
    } else {
      feats[cid] = 1.0;
    }
  }

  for (const c of boardSorted) {
    feats[104 + cardToId(c)] = 1.0;
  }

  let deadDora = 0;
  const seenDead = new Set<Card>();
  for (const p of snap.players.values()) {
    if (p.seat !== selfSeat) {
      for (const c of p.exposedCards) {
        if (!seenDead.has(c)) {
          seenDead.add(c);
          feats[156 + cardToId(c)] = 1.0;
          if (c[0] === snap.legalDoraRank) deadDora++;
        }
      }
    }
    for (const c of p.faceUpDiscards) {
      if (!seenDead.has(c)) {
        seenDead.add(c);
        feats[156 + cardToId(c)] = 1.0;
        if (c[0] === snap.legalDoraRank) deadDora++;
      }
    }
  }

  feats[208 + RANK_INDEX[snap.legalDoraRank]] = 1.0;

  let myEval: Evaluated5CardHand | null = null;
  let myRank = 1;
  let topTb = 0;
  let best5Dora = 0;
  let best5Set = new Set<Card>();

  if (!selfP.isFolded && holeSorted.length + boardSorted.length >= 5) {
    myEval = findBestHand(holeSorted, boardSorted, snap.legalDoraRank);
    myRank = myEval.rank;
    topTb = myEval.tieBreakers[0] ?? 0;
    best5Dora = myEval.doraCount;
    best5Set = new Set(myEval.best5Cards);
  }

  feats[221 + (myRank - 1)] = 1.0;

  const myTotalDora = holeSorted.filter(c => c[0] === snap.legalDoraRank).length;
  const boardDora = boardSorted.filter(c => c[0] === snap.legalDoraRank).length;
  const poolAll = [...holeSorted, ...boardSorted];

  let bestSwapRankGain = 0;
  let bestSwapDoraGain = 0;
  if (!selfP.isFolded && myEval) {
    const swappable = holeSorted.filter(c => !exposedSet.has(c));
    for (const hC of swappable) {
      for (const bC of boardSorted) {
        const tHole = holeSorted.filter(c => c !== hC);
        tHole.push(bC);
        const tBoard = boardSorted.map(c => (c === bC ? hC : c));
        const tEval = findBestHand(tHole, tBoard, snap.legalDoraRank);
        const rDiff = tEval.rank - myRank;
        if (rDiff > bestSwapRankGain) bestSwapRankGain = rDiff;
        if (compare5CardHands(tEval, myEval) >= 0) {
          const dDiff = tEval.doraCount - best5Dora;
          if (dDiff > bestSwapDoraGain) bestSwapDoraGain = dDiff;
        }
      }
    }
  }

  feats[231] = topTb / 14.0;
  feats[232] = best5Dora / 4.0;
  feats[233] = myTotalDora / 4.0;
  feats[234] = boardDora / 4.0;
  feats[235] = deadDora / 4.0;
  feats[236] = (holeSorted.length - exposedSet.size) / 5.0;
  feats[237] = exposedSet.size / 5.0;
  feats[238] = has4FlushDraw(poolAll);
  feats[239] = has4StraightDraw(poolAll);
  feats[240] = Math.min(bestSwapRankGain, 9) / 9.0;
  feats[241] = Math.min(bestSwapDoraGain, 4) / 4.0;
  feats[242] = Math.min(snap.currentOrbit, 20) / 10.0;
  feats[243] = Math.min(boardSorted.length, 12) / 8.0;
  feats[244] = snap.drawPileLength / 40.0;
  feats[245] = snap.drawPileLength <= 4 ? 1.0 : 0.0;
  feats[246] = Math.min(snap.currentPot, 40) / 20.0;

  let activeCount = 0;
  for (const pl of snap.players.values()) {
    if (!pl.isFolded) activeCount++;
  }
  const relPos = (selfSeat - snap.dealerSeat + snap.playerCount) % snap.playerCount;
  const estBase = boardSorted.length + snap.currentOrbit + best5Dora;
  feats[247] = activeCount / 5.0;
  feats[248] = snap.playerCount / 5.0;
  feats[249] = relPos / 4.0;
  feats[250] = selfSeat === snap.dealerSeat ? 1.0 : 0.0;
  feats[251] = estBase / 15.0;
  feats[252] = snap.currentOrbit / Math.max(1.0, boardSorted.length + snap.currentOrbit);
  feats[253] = snap.discardPileLength / 30.0;
  feats[254] = Math.max(-1.0, Math.min(1.0, selfP.chipScore / 30.0));

  for (let k = 0; k < 4; k++) {
    const base = 255 + k * 6;
    if (k < snap.playerCount - 1) {
      const oppSeat = ((selfSeat - 1 + (k + 1)) % snap.playerCount) + 1;
      const op = snap.players.get(oppSeat)!;
      feats[base + 0] = 1.0;
      feats[base + 1] = op.isFolded ? 0.0 : 1.0;
      feats[base + 2] = op.isFolded ? 1.0 : 0.0;
      feats[base + 3] = op.exposedCards.length / 5.0;
      feats[base + 4] = Math.min(op.faceUpDiscards.length, 10) / 10.0;
      feats[base + 5] = op.exposedCards.filter(c => c[0] === snap.legalDoraRank).length / 4.0;
    }
  }

  for (let i = 0; i < Math.min(holeSorted.length, MAX_HOLE_SLOTS); i++) {
    const c = holeSorted[i];
    const base = 279 + i * 4;
    feats[base + 0] = best5Set.has(c) ? 1.0 : 0.0;
    feats[base + 1] = c[0] === snap.legalDoraRank ? 1.0 : 0.0;
    feats[base + 2] = exposedSet.has(c) ? 1.0 : 0.0;
    feats[base + 3] = parseCard(c).value / 14.0;
  }

  for (let b = 0; b < Math.min(boardSorted.length, MAX_BOARD_SLOTS); b++) {
    const c = boardSorted[b];
    const base = 299 + b * 4;
    feats[base + 0] = 1.0;
    feats[base + 1] = best5Set.has(c) ? 1.0 : 0.0;
    feats[base + 2] = c[0] === snap.legalDoraRank ? 1.0 : 0.0;
    feats[base + 3] = parseCard(c).value / 14.0;
  }

  return feats;
}

export function encodeCriticObs(
  snap: SnapshotForEncoding,
  selfSeat: number,
  precomputedActor?: Float32Array
): Float32Array {
  const actorFeats = precomputedActor ?? encodeActorObs(snap, selfSeat);
  const full = new Float32Array(OBS_CRITIC_DIM);
  full.set(actorFeats, 0);

  const offset = OBS_ACTOR_DIM;
  const selfP = snap.players.get(selfSeat)!;
  const board = snap.communityCards;
  const selfActive = !selfP.isFolded && selfP.holeCards.length > 0 && selfP.holeCards.length + board.length >= 5;
  const selfEval = selfActive ? findBestHand(selfP.holeCards, board, snap.legalDoraRank) : null;

  const activeEvals: Array<{ seat: number; ev: Evaluated5CardHand }> = [];
  if (selfEval) activeEvals.push({ seat: selfSeat, ev: selfEval });

  let numBeating = 0;
  let numTying = 0;

  for (let k = 0; k < 4; k++) {
    if (k < snap.playerCount - 1) {
      const oppSeat = ((selfSeat - 1 + (k + 1)) % snap.playerCount) + 1;
      const op = snap.players.get(oppSeat)!;
      if (!op.isFolded && op.holeCards.length > 0) {
        for (const c of op.holeCards) {
          full[offset + k * 52 + cardToId(c)] = 1.0;
        }
        if (op.holeCards.length + board.length >= 5) {
          const oEval = findBestHand(op.holeCards, board, snap.legalDoraRank);
          activeEvals.push({ seat: oppSeat, ev: oEval });
          const base = offset + 208 + k * 6;
          full[base + 0] = oEval.rank / 10.0;
          full[base + 1] = (oEval.tieBreakers[0] ?? 0) / 14.0;
          full[base + 2] = oEval.doraCount / 4.0;
          if (selfEval) {
            const cmp = compare5CardHands(oEval, selfEval);
            full[base + 3] = cmp > 0 ? 1.0 : 0.0;
            full[base + 4] = cmp === 0 ? 1.0 : 0.0;
            full[base + 5] = Math.max(-1.0, Math.min(1.0, (oEval.rank - selfEval.rank) / 9.0));
            if (cmp > 0) numBeating++;
            else if (cmp === 0) numTying++;
          }
        }
      }
    }
  }

  if (selfEval && activeEvals.length > 0) {
    let bestOverall = activeEvals[0].ev;
    for (let i = 1; i < activeEvals.length; i++) {
      if (compare5CardHands(activeEvals[i].ev, bestOverall) > 0) {
        bestOverall = activeEvals[i].ev;
      }
    }
    const winners = activeEvals.filter(a => compare5CardHands(a.ev, bestOverall) === 0);
    const winnerSeats = new Set(winners.map(w => w.seat));
    const winnerDora = Math.max(...winners.map(w => w.ev.doraCount));
    const baseScore = board.length + snap.currentOrbit + winnerDora;
    const losersCount = activeEvals.length - winners.length;
    const totalPrize = losersCount * baseScore + snap.currentPot;

    let trueShowdownEv = 0;
    if (activeEvals.length === 1) {
      trueShowdownEv = snap.currentPot;
    } else if (winnerSeats.has(selfSeat)) {
      const share = Math.floor(totalPrize / winners.length);
      const rem = totalPrize % winners.length;
      let oddSeat: number | undefined;
      if (rem > 0) {
        for (let i = 0; i < snap.playerCount; i++) {
          const s = ((snap.dealerSeat - 1 + i) % snap.playerCount) + 1;
          if (winnerSeats.has(s)) {
            oddSeat = s;
            break;
          }
        }
      }
      trueShowdownEv = share + (selfSeat === oddSeat ? rem : 0);
    } else {
      trueShowdownEv = -baseScore;
    }

    full[offset + 232] = numBeating === 0 && numTying === 0 ? 1.0 : 0.0;
    full[offset + 233] = numBeating === 0 && numTying > 0 ? 1.0 : 0.0;
    full[offset + 234] = numBeating / 4.0;
    full[offset + 235] = Math.max(-2.0, Math.min(2.0, trueShowdownEv / 15.0));
    full[offset + 236] = Math.max(-2.0, Math.min(2.0, -snap.currentOrbit / 15.0));
    full[offset + 237] = winnerDora / 4.0;

    if (snap.topDrawCard) {
      full[offset + 238] = snap.topDrawCard[0] === snap.legalDoraRank ? 1.0 : 0.0;
      const tEval = findBestHand(selfP.holeCards, [...board, snap.topDrawCard], snap.legalDoraRank);
      full[offset + 239] = compare5CardHands(tEval, selfEval) > 0 ? 1.0 : 0.0;
    }
  } else {
    full[offset + 235] = Math.max(-2.0, Math.min(2.0, -(selfP.foldOrbit ?? 0) / 15.0));
    full[offset + 236] = Math.max(-2.0, Math.min(2.0, -snap.currentOrbit / 15.0));
  }

  return full;
}

export function getDistilledEntry(
  model: LoadedAiModel | null,
  rank: number,
  doraCount: number,
  orbit: number
): DistilledStateEntry | null {
  if (!model) return null;
  const dBucket = Math.min(doraCount, 3);
  const oBucket = Math.min(orbit, 4);
  return model.distilledTable[`${rank}_${dBucket}_${oBucket}`] || null;
}
