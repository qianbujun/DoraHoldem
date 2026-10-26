// 宿命公牌 (Dora Hold'em) - 卡牌核心模型

export type Suit = 's' | 'h' | 'c' | 'd'; // Spades, Hearts, Clubs, Diamonds
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Card = `${Rank}${Suit}`;

export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS: Suit[] = ['s', 'h', 'c', 'd'];

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  'T': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14,
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  c: '♣',
  d: '♦',
};

/**
 * 解析单张卡牌
 */
export function parseCard(card: Card): { rank: Rank; suit: Suit; value: number } {
  const rank = card[0] as Rank;
  const suit = card[1] as Suit;
  return {
    rank,
    suit,
    value: RANK_VALUES[rank],
  };
}

/**
 * 创建标准52张扑克牌副（无大小王）
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

/**
 * 随机混洗（Fisher-Yates 算法）
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

