// 宿命公牌 (Dora Hold'em) - 全局共享类型定义

export type Suit = 's' | 'h' | 'c' | 'd'; // Spades, Hearts, Clubs, Diamonds
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

/**
 * 卡牌字符串表示，例如 "9d", "As", "Th"
 */
export type Card = `${Rank}${Suit}`;

export const SUIT_SYMBOLS: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  c: '♣',
  d: '♦',
};

export const SUIT_COLORS: Record<Suit, 'red' | 'black'> = {
  s: 'black',
  h: 'red',
  c: 'black',
  d: 'red',
};

export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS: Suit[] = ['s', 'h', 'c', 'd'];

/**
 * 德州扑克牌型等级（从大到小）
 */
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

export interface EvaluatedHand {
  rank: HandRank;
  rankNameKey: string; // e.g. "pokerHands.fourOfAKind"
  best5Cards: Card[];  // 严格数学最佳5张成牌
  tieBreakers: number[]; // 用于平局判决的点数权重队列
  doraCount: number;   // 最佳5张牌中实际包含的生效宝牌数
}

/**
 * 5大行动枚举
 */
export enum TurnActionType {
  DISCARD_DRAW = 'DISCARD_DRAW',         // 动作1: 弃牌换牌（弃1张或弃2张）
  MANIPULATE_SWAP = 'MANIPULATE_SWAP',   // 动作2A: 操控公牌 - 公私置换
  MANIPULATE_BANISH = 'MANIPULATE_BANISH', // 动作2B: 操控公牌 - 放逐刷新
  EXPAND_BOARD = 'EXPAND_BOARD',         // 动作3: 增加公牌
  FOLD = 'FOLD',                         // 动作4: 弃牌跑路
  CALL_SHOWDOWN = 'CALL_SHOWDOWN',       // 动作5: 终结决战
}

/**
 * 终局触发方式
 */
export enum GameEndReason {
  VOLUNTARY_SHOWDOWN = 'voluntary_showdown', // 动作5触发
  DECK_DEPLETED = 'deck_depleted',           // 回合开始时摸牌堆 < 2张
  LONE_SURVIVOR = 'lone_survivor',           // 其余玩家全部跑路
}

/**
 * 玩家对局公开状态（脱敏，防作弊）
 */
export interface PublicPlayerState {
  seat: number;             // 座位号 1 ~ 5
  userId: number;
  username: string;
  cardCount: number;        // 暗牌数量（不透露点数）
  exposedCards: Card[];     // 公私置换得到的明置手牌（全场可见）
  faceUpDiscards: Card[];   // 本小局自己明置弃掉的牌（横置展示）
  isFolded: boolean;        // 是否已跑路
  foldOrbit?: number;       // 跑路时的巡目
  isDealer: boolean;        // 是否是本局庄家
  chipScore: number;        // 房间累计积分
}

/**
 * 玩家自己的私有手牌状态
 */
export interface PrivatePlayerState extends PublicPlayerState {
  holeCards: Card[];        // 包含所有手牌（暗牌 + 明置换入牌）
}

/**
 * 房间公开对局状态快照
 */
export interface PublicGameState {
  roomId: string;
  roundNumber: number;
  totalRounds: number;
  currentOrbit: number;
  dealerSeat: number;
  currentTurnSeat: number;
  legalDoraRank: Rank;
  initialDoraCard: Card;
  communityCards: Card[];
  drawPileCount: number;
  discardPileCount: number;
  currentPot: number;
  baseScoreEstimate: number; // 当前预估基础分: 公牌数 + 巡目数 (+ 潜在宝牌)
  players: PublicPlayerState[];
  isHandFinished: boolean;
  gameStatus: 'waiting' | 'playing' | 'round_end' | 'match_finished';
}

/**
 * 终局结算结果
 */
export interface HandSettlement {
  handRecordId?: number;
  endReason: GameEndReason;
  finalOrbit: number;
  finalCommunityCards: Card[];
  legalDoraRank: Rank;
  baseScore: number; // 公牌数 + 巡目数 + 胜者成牌宝牌数
  winnerSeats: number[];
  oddChipWinnerSeat?: number; // 余数顺位胜者
  playerResults: {
    seat: number;
    userId: number;
    username: string;
    isWinner: boolean;
    isFolded: boolean;
    revealedHoleCards: Card[]; // 终局全桌公开的底牌
    bestHand?: EvaluatedHand;  // 跑路玩家无成牌
    doraInBestHand: number;
    scoreChange: number;       // 本局净胜分（如 +17 或 -8）
    cumulativeScore: number;   // 累加后总积分
  }[];
}

/**
 * 历史牌谱中的单步行动事件记录
 */
export interface HandActionLogItem {
  step: number;
  orbit: number;
  seat: number;
  username: string;
  action: TurnActionType;
  details: {
    discardFaceUp?: Card;
    discardFaceDownCount?: number;
    discardFaceDown?: Card;
    drawCount?: number;
    drawnCards?: Card[];
    swappedHandCard?: Card;
    swappedBoardCard?: Card;
    banishedCard?: Card;
    refreshedCard?: Card;
    expandedCard?: Card;
    foldCost?: number;
  };
  communityCardsAfter: Card[];
  playerSnapshots?: {
    seat: number;
    holeCards: Card[];
    exposedCards: Card[];
    isFolded: boolean;
  }[];
  timestamp: number;
}

