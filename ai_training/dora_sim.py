"""
宿命公牌 (Dora Hold'em) - 权威规则 Python 模拟器 & 特征提取器
严格对齐 server/src/engine/card.ts, evaluator.ts, gameState.ts 的每一条数学判定与状态流转。
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
SUITS = ['s', 'h', 'c', 'd']
RANK_TO_VAL = {r: i + 2 for i, r in enumerate(RANKS)}
RANK_TO_IDX = {r: i for i, r in enumerate(RANKS)}
SUIT_TO_IDX = {s: i for i, s in enumerate(SUITS)}

# 0..51 卡牌整数编码: rank_idx * 4 + suit_idx
ALL_CARDS: Tuple[int, ...] = tuple(range(52))
CARD_RANK_IDX: Tuple[int, ...] = tuple(c // 4 for c in ALL_CARDS)
CARD_RANK_VAL: Tuple[int, ...] = tuple((c // 4) + 2 for c in ALL_CARDS)
CARD_SUIT_IDX: Tuple[int, ...] = tuple(c % 4 for c in ALL_CARDS)
CARD_STRS: Tuple[str, ...] = tuple(f"{RANKS[c // 4]}{SUITS[c % 4]}" for c in ALL_CARDS)
STR_TO_CARD: Dict[str, int] = {s: i for i, s in enumerate(CARD_STRS)}

# HandRank (与 TypeScript evaluator.ts 完全一致)
HIGH_CARD = 1
ONE_PAIR = 2
TWO_PAIR = 3
THREE_OF_A_KIND = 4
STRAIGHT = 5
FLUSH = 6
FULL_HOUSE = 7
FOUR_OF_A_KIND = 8
STRAIGHT_FLUSH = 9
ROYAL_FLUSH = 10

# 统一离散动作空间 (76 维)
MAX_HOLE_SLOTS = 5
MAX_BOARD_SLOTS = 8

ACT_CALL_SHOWDOWN = 0
ACT_FOLD = 1
ACT_EXPAND_BOARD = 2
ACT_DISCARD1_OFFSET = 3                         # 3..7 (5)
ACT_DISCARD2_OFFSET = 8                         # 8..27 (5*4 = 20, ordered (i, j), i != j)
ACT_SWAP_OFFSET = 28                            # 28..67 (5*8 = 40, (h_slot, b_slot))
ACT_BANISH_OFFSET = 68                          # 68..75 (8, b_slot)
NUM_ACTIONS = 76

# 构建 DISCARD2 索引映射
DISCARD2_PAIRS: List[Tuple[int, int]] = []
DISCARD2_LOOKUP: Dict[Tuple[int, int], int] = {}
for _i in range(MAX_HOLE_SLOTS):
    for _j in range(MAX_HOLE_SLOTS):
        if _i != _j:
            DISCARD2_LOOKUP[(_i, _j)] = ACT_DISCARD2_OFFSET + len(DISCARD2_PAIRS)
            DISCARD2_PAIRS.append((_i, _j))

# 特征维度 (与 TypeScript neuralNet.ts 严格对齐)
OBS_ACTOR_DIM = 331
OBS_GOD_EXTRA_DIM = 240
OBS_CRITIC_DIM = OBS_ACTOR_DIM + OBS_GOD_EXTRA_DIM  # 571


def card_from_str(s: str) -> int:
    return STR_TO_CARD[s]


def card_to_str(c: int) -> str:
    return CARD_STRS[c]


def evaluate_5cards(cards: Sequence[int], legal_dora_idx: int) -> Tuple[int, Tuple[int, ...], int, Tuple[int, ...]]:
    """
    评估 5 张牌:
    返回 (rank, tie_breakers, dora_count, ordered_5cards)
    排序与平局比较逻辑严格对齐 evaluator.ts
    """
    # 按点数降序
    sorted_cards = sorted(cards, key=lambda c: CARD_RANK_VAL[c], reverse=True)
    vals = [CARD_RANK_VAL[c] for c in sorted_cards]
    suits = [CARD_SUIT_IDX[c] for c in sorted_cards]

    is_flush = (suits[0] == suits[1] == suits[2] == suits[3] == suits[4])

    # 统计频次
    rank_counts: Dict[int, int] = {}
    rank_cards: Dict[int, List[int]] = {}
    for c, v in zip(sorted_cards, vals):
        rank_counts[v] = rank_counts.get(v, 0) + 1
        if v not in rank_cards:
            rank_cards[v] = []
        rank_cards[v].append(c)

    unique_vals = sorted(rank_counts.keys(), reverse=True)
    is_straight = False
    straight_high = 0
    if len(unique_vals) == 5:
        if unique_vals[0] - unique_vals[4] == 4:
            is_straight = True
            straight_high = unique_vals[0]
        elif unique_vals == [14, 5, 4, 3, 2]:
            is_straight = True
            straight_high = 5

    dora_count = sum(1 for c in cards if CARD_RANK_IDX[c] == legal_dora_idx)

    if is_flush and is_straight:
        rk = ROYAL_FLUSH if straight_high == 14 else STRAIGHT_FLUSH
        return rk, (straight_high,), dora_count, tuple(sorted_cards)

    groups = sorted(
        ((v, cnt, rank_cards[v]) for v, cnt in rank_counts.items()),
        key=lambda x: (x[1], x[0]),
        reverse=True,
    )

    if groups[0][1] == 4:
        ordered = tuple(groups[0][2] + groups[1][2])
        return FOUR_OF_A_KIND, (groups[0][0], groups[1][0]), dora_count, ordered

    if groups[0][1] == 3 and groups[1][1] == 2:
        ordered = tuple(groups[0][2] + groups[1][2])
        return FULL_HOUSE, (groups[0][0], groups[1][0]), dora_count, ordered

    if is_flush:
        return FLUSH, tuple(vals), dora_count, tuple(sorted_cards)

    if is_straight:
        if straight_high == 5 and unique_vals[0] == 14:
            ordered = tuple(
                rank_cards[5] + rank_cards[4] + rank_cards[3] + rank_cards[2] + rank_cards[14]
            )
        else:
            ordered = tuple(sorted_cards)
        return STRAIGHT, (straight_high,), dora_count, ordered

    if groups[0][1] == 3:
        ordered = tuple(groups[0][2] + groups[1][2] + groups[2][2])
        return THREE_OF_A_KIND, (groups[0][0], groups[1][0], groups[2][0]), dora_count, ordered

    if groups[0][1] == 2 and groups[1][1] == 2:
        ordered = tuple(groups[0][2] + groups[1][2] + groups[2][2])
        return TWO_PAIR, (groups[0][0], groups[1][0], groups[2][0]), dora_count, ordered

    if groups[0][1] == 2:
        ordered = tuple(groups[0][2] + groups[1][2] + groups[2][2] + groups[3][2])
        return ONE_PAIR, (groups[0][0], groups[1][0], groups[2][0], groups[3][0]), dora_count, ordered

    return HIGH_CARD, tuple(vals), dora_count, tuple(sorted_cards)


def compare_eval(a: Tuple[int, Tuple[int, ...], int, Tuple[int, ...]],
                 b: Tuple[int, Tuple[int, ...], int, Tuple[int, ...]]) -> int:
    """只比较牌型与 tieBreakers (不含宝牌数，与 compare5CardHands 完全一致)"""
    if a[0] != b[0]:
        return 1 if a[0] > b[0] else -1
    ta, tb = a[1], b[1]
    for x, y in zip(ta, tb):
        if x != y:
            return 1 if x > y else -1
    return 0


def find_best_hand(hole_cards: Sequence[int], community_cards: Sequence[int], legal_dora_idx: int) -> Tuple[int, Tuple[int, ...], int, Tuple[int, ...]]:
    pool = sorted((list(hole_cards) + list(community_cards)), reverse=True)
    if len(pool) == 5:
        return evaluate_5cards(pool, legal_dora_idx)

    best_score = -1
    best_dora = -1
    best_comb = None
    rank_vals = CARD_RANK_VAL
    rank_idxs = CARD_RANK_IDX

    for comb in itertools.combinations(pool, 5):
        c0, c1, c2, c3, c4 = comb
        v0 = rank_vals[c0]
        v1 = rank_vals[c1]
        v2 = rank_vals[c2]
        v3 = rank_vals[c3]
        v4 = rank_vals[c4]

        is_flush = (c0 & 3) == (c1 & 3) == (c2 & 3) == (c3 & 3) == (c4 & 3)
        if v0 != v1 and v1 != v2 and v2 != v3 and v3 != v4:
            if v0 - v4 == 4:
                rk = (ROYAL_FLUSH if v0 == 14 else STRAIGHT_FLUSH) if is_flush else STRAIGHT
                score = (rk << 20) | (v0 << 16)
            elif v0 == 14 and v1 == 5:
                rk = STRAIGHT_FLUSH if is_flush else STRAIGHT
                score = (rk << 20) | (5 << 16)
            elif is_flush:
                score = (FLUSH << 20) | (v0 << 16) | (v1 << 12) | (v2 << 8) | (v3 << 4) | v4
            else:
                score = (HIGH_CARD << 20) | (v0 << 16) | (v1 << 12) | (v2 << 8) | (v3 << 4) | v4
        else:
            if v0 == v3:
                score = (FOUR_OF_A_KIND << 20) | (v0 << 16) | (v4 << 12)
            elif v1 == v4:
                score = (FOUR_OF_A_KIND << 20) | (v1 << 16) | (v0 << 12)
            elif v0 == v2 and v3 == v4:
                score = (FULL_HOUSE << 20) | (v0 << 16) | (v3 << 12)
            elif v0 == v1 and v2 == v4:
                score = (FULL_HOUSE << 20) | (v2 << 16) | (v0 << 12)
            elif is_flush:
                score = (FLUSH << 20) | (v0 << 16) | (v1 << 12) | (v2 << 8) | (v3 << 4) | v4
            elif v0 == v2:
                score = (THREE_OF_A_KIND << 20) | (v0 << 16) | (v3 << 12) | (v4 << 8)
            elif v1 == v3:
                score = (THREE_OF_A_KIND << 20) | (v1 << 16) | (v0 << 12) | (v4 << 8)
            elif v2 == v4:
                score = (THREE_OF_A_KIND << 20) | (v2 << 16) | (v0 << 12) | (v1 << 8)
            elif v0 == v1 and v2 == v3:
                score = (TWO_PAIR << 20) | (v0 << 16) | (v2 << 12) | (v4 << 8)
            elif v0 == v1 and v3 == v4:
                score = (TWO_PAIR << 20) | (v0 << 16) | (v3 << 12) | (v2 << 8)
            elif v1 == v2 and v3 == v4:
                score = (TWO_PAIR << 20) | (v1 << 16) | (v3 << 12) | (v0 << 8)
            elif v0 == v1:
                score = (ONE_PAIR << 20) | (v0 << 16) | (v2 << 12) | (v3 << 8) | (v4 << 4)
            elif v1 == v2:
                score = (ONE_PAIR << 20) | (v1 << 16) | (v0 << 12) | (v3 << 8) | (v4 << 4)
            elif v2 == v3:
                score = (ONE_PAIR << 20) | (v2 << 16) | (v0 << 12) | (v1 << 8) | (v4 << 4)
            else:
                score = (ONE_PAIR << 20) | (v3 << 16) | (v0 << 12) | (v1 << 8) | (v2 << 4)

        if score > best_score:
            best_score = score
            best_dora = (
                (1 if rank_idxs[c0] == legal_dora_idx else 0)
                + (1 if rank_idxs[c1] == legal_dora_idx else 0)
                + (1 if rank_idxs[c2] == legal_dora_idx else 0)
                + (1 if rank_idxs[c3] == legal_dora_idx else 0)
                + (1 if rank_idxs[c4] == legal_dora_idx else 0)
            )
            best_comb = comb
        elif score == best_score:
            dora = (
                (1 if rank_idxs[c0] == legal_dora_idx else 0)
                + (1 if rank_idxs[c1] == legal_dora_idx else 0)
                + (1 if rank_idxs[c2] == legal_dora_idx else 0)
                + (1 if rank_idxs[c3] == legal_dora_idx else 0)
                + (1 if rank_idxs[c4] == legal_dora_idx else 0)
            )
            if dora > best_dora:
                best_dora = dora
                best_comb = comb

    assert best_comb is not None
    return evaluate_5cards(best_comb, legal_dora_idx)


@dataclass
class SimPlayer:
    seat: int
    hole_cards: List[int] = field(default_factory=list)
    exposed_cards: List[int] = field(default_factory=list)
    face_up_discards: List[int] = field(default_factory=list)
    is_folded: bool = False
    fold_orbit: int = 0
    chip_score: int = 0


class DoraHoldemSim:
    """单小局权威模拟器（2~5人）"""

    def __init__(self, player_count: int = 4, seed: Optional[int] = None):
        self.rng = random.Random(seed)
        self.player_count = player_count
        self.dealer_seat = 1
        self.current_orbit = 1
        self.current_turn_seat = 1
        self.community_cards: List[int] = []
        self.draw_pile: List[int] = []
        self.discard_pile: List[int] = []
        self.current_pot = 0
        self.players: Dict[int, SimPlayer] = {}
        self.is_finished = False
        self.end_reason = ""
        self.last_score_changes: Dict[int, int] = {}
        self.legal_dora_idx = 0
        self.reset(player_count=player_count)

    def reset(self, player_count: Optional[int] = None, dealer_seat: Optional[int] = None) -> None:
        if player_count is not None:
            self.player_count = player_count
        self.dealer_seat = dealer_seat if dealer_seat is not None else self.rng.randint(1, self.player_count)
        self.current_orbit = 1
        self.current_turn_seat = self.dealer_seat
        self.current_pot = 0
        self.discard_pile = []
        self.is_finished = False
        self.end_reason = ""
        self.last_score_changes = {s: 0 for s in range(1, self.player_count + 1)}

        deck = list(ALL_CARDS)
        self.rng.shuffle(deck)

        self.players = {}
        for s in range(1, self.player_count + 1):
            hole = deck[:5]
            deck = deck[5:]
            self.players[s] = SimPlayer(seat=s, hole_cards=hole)

        first_comm = deck.pop(0)
        self.community_cards = [first_comm]
        self.legal_dora_idx = CARD_RANK_IDX[first_comm]
        self.draw_pile = deck

    def clone(self) -> "DoraHoldemSim":
        c = DoraHoldemSim.__new__(DoraHoldemSim)
        c.rng = random.Random()
        c.player_count = self.player_count
        c.dealer_seat = self.dealer_seat
        c.current_orbit = self.current_orbit
        c.current_turn_seat = self.current_turn_seat
        c.community_cards = list(self.community_cards)
        c.draw_pile = list(self.draw_pile)
        c.discard_pile = list(self.discard_pile)
        c.current_pot = self.current_pot
        c.is_finished = self.is_finished
        c.end_reason = self.end_reason
        c.last_score_changes = dict(self.last_score_changes)
        c.legal_dora_idx = self.legal_dora_idx
        c.players = {
            s: SimPlayer(
                seat=p.seat,
                hole_cards=list(p.hole_cards),
                exposed_cards=list(p.exposed_cards),
                face_up_discards=list(p.face_up_discards),
                is_folded=p.is_folded,
                fold_orbit=p.fold_orbit,
                chip_score=p.chip_score,
            )
            for s, p in self.players.items()
        }
        return c

    def get_sorted_hole(self, seat: int) -> List[int]:
        return sorted(self.players[seat].hole_cards)

    def get_sorted_board(self) -> List[int]:
        return sorted(self.community_cards)

    def get_legal_action_mask(self, seat: int) -> List[int]:
        mask = [0] * NUM_ACTIONS
        if self.is_finished or self.current_turn_seat != seat:
            return mask
        p = self.players[seat]
        if p.is_folded:
            return mask

        mask[ACT_CALL_SHOWDOWN] = 1
        mask[ACT_FOLD] = 1
        if len(self.draw_pile) >= 1:
            mask[ACT_EXPAND_BOARD] = 1

        hole = self.get_sorted_hole(seat)
        board = self.get_sorted_board()
        exposed_set = set(p.exposed_cards)
        n_hole = len(hole)
        n_board = min(len(board), MAX_BOARD_SLOTS)

        if len(self.draw_pile) >= 1:
            for i in range(n_hole):
                mask[ACT_DISCARD1_OFFSET + i] = 1

        if len(self.draw_pile) >= 2 and n_hole >= 2:
            for idx, (i, j) in enumerate(DISCARD2_PAIRS):
                if i < n_hole and j < n_hole:
                    mask[ACT_DISCARD2_OFFSET + idx] = 1

        for i in range(n_hole):
            if hole[i] not in exposed_set:
                for b in range(n_board):
                    mask[ACT_SWAP_OFFSET + i * MAX_BOARD_SLOTS + b] = 1

        if len(self.draw_pile) >= 1:
            for b in range(n_board):
                mask[ACT_BANISH_OFFSET + b] = 1

        return mask

    def step(self, action_id: int) -> Tuple[bool, Dict[int, int]]:
        """执行当前回合玩家的一个离散动作，返回 (is_finished, score_changes)"""
        seat = self.current_turn_seat
        p = self.players[seat]
        hole = self.get_sorted_hole(seat)
        board = self.get_sorted_board()

        if action_id == ACT_CALL_SHOWDOWN:
            self._trigger_showdown("voluntary_showdown")
            return True, dict(self.last_score_changes)

        if action_id == ACT_FOLD:
            fold_cost = self.current_orbit
            p.is_folded = True
            p.fold_orbit = fold_cost
            p.chip_score -= fold_cost
            self.current_pot += fold_cost
            self.discard_pile.extend(p.hole_cards)
            p.hole_cards = []
            p.exposed_cards = []
            active = [pl for pl in self.players.values() if not pl.is_folded]
            if len(active) == 1:
                self._trigger_showdown("lone_survivor")
                return True, dict(self.last_score_changes)
            self._advance_turn()
            self._check_turn_start()
            return self.is_finished, dict(self.last_score_changes)

        if action_id == ACT_EXPAND_BOARD:
            card = self.draw_pile.pop(0)
            self.community_cards.append(card)
            self._advance_turn()
            self._check_turn_start()
            return self.is_finished, dict(self.last_score_changes)

        if ACT_DISCARD1_OFFSET <= action_id < ACT_DISCARD2_OFFSET:
            i = action_id - ACT_DISCARD1_OFFSET
            up_card = hole[i]
            p.hole_cards = [c for c in p.hole_cards if c != up_card]
            p.exposed_cards = [c for c in p.exposed_cards if c != up_card]
            p.face_up_discards.append(up_card)
            drawn = self.draw_pile.pop(0)
            p.hole_cards.append(drawn)
            self._advance_turn()
            self._check_turn_start()
            return self.is_finished, dict(self.last_score_changes)

        if ACT_DISCARD2_OFFSET <= action_id < ACT_SWAP_OFFSET:
            i, j = DISCARD2_PAIRS[action_id - ACT_DISCARD2_OFFSET]
            up_card = hole[i]
            down_card = hole[j]
            p.hole_cards = [c for c in p.hole_cards if c != up_card and c != down_card]
            p.exposed_cards = [c for c in p.exposed_cards if c != up_card and c != down_card]
            p.face_up_discards.append(up_card)
            self.discard_pile.append(down_card)
            drawn = self.draw_pile[:2]
            self.draw_pile = self.draw_pile[2:]
            p.hole_cards.extend(drawn)
            self._advance_turn()
            self._check_turn_start()
            return self.is_finished, dict(self.last_score_changes)

        if ACT_SWAP_OFFSET <= action_id < ACT_BANISH_OFFSET:
            rel = action_id - ACT_SWAP_OFFSET
            i = rel // MAX_BOARD_SLOTS
            b = rel % MAX_BOARD_SLOTS
            hand_card = hole[i]
            board_card = board[b]
            b_idx = self.community_cards.index(board_card)
            p.hole_cards = [c for c in p.hole_cards if c != hand_card]
            p.hole_cards.append(board_card)
            p.exposed_cards.append(board_card)
            self.community_cards[b_idx] = hand_card
            self._advance_turn()
            self._check_turn_start()
            return self.is_finished, dict(self.last_score_changes)

        if ACT_BANISH_OFFSET <= action_id < NUM_ACTIONS:
            b = action_id - ACT_BANISH_OFFSET
            board_card = board[b]
            b_idx = self.community_cards.index(board_card)
            self.discard_pile.append(board_card)
            refreshed = self.draw_pile.pop(0)
            self.community_cards[b_idx] = refreshed
            self._advance_turn()
            self._check_turn_start()
            return self.is_finished, dict(self.last_score_changes)

        raise ValueError(f"Invalid action_id: {action_id}")

    def _advance_turn(self) -> None:
        if self.is_finished:
            return
        next_seat = self.current_turn_seat
        attempts = 0
        while True:
            next_seat = (next_seat % self.player_count) + 1
            attempts += 1
            if attempts > self.player_count:
                return
            if not self.players[next_seat].is_folded:
                break
        if next_seat == self.dealer_seat:
            self.current_orbit += 1
        self.current_turn_seat = next_seat

    def _check_turn_start(self) -> None:
        if self.is_finished:
            return
        if len(self.draw_pile) < 2:
            self._trigger_showdown("deck_depleted")

    def _trigger_showdown(self, reason: str) -> None:
        self.is_finished = True
        self.end_reason = reason
        active = [p for p in self.players.values() if not p.is_folded]

        if reason == "lone_survivor" or len(active) == 1:
            winner = active[0]
            win_profit = self.current_pot
            winner.chip_score += win_profit
            self.last_score_changes = {
                p.seat: (win_profit if p.seat == winner.seat else -p.fold_orbit)
                for p in self.players.values()
            }
            return

        evaluated = [(p, find_best_hand(p.hole_cards, self.community_cards, self.legal_dora_idx)) for p in active]
        # 按成牌强度降序
        best_eval = evaluated[0][1]
        for _, ev in evaluated[1:]:
            if compare_eval(ev, best_eval) > 0:
                best_eval = ev

        winners = [p for p, ev in evaluated if compare_eval(ev, best_eval) == 0]
        winner_seats = {p.seat for p in winners}
        winner_dora = max(ev[2] for p, ev in evaluated if p.seat in winner_seats)

        base_score = len(self.community_cards) + self.current_orbit + winner_dora
        losers = [p for p, _ in evaluated if p.seat not in winner_seats]
        total_prize = len(losers) * base_score + self.current_pot

        for lp in losers:
            lp.chip_score -= base_score

        share = total_prize // len(winners)
        remainder = total_prize % len(winners)

        odd_winner_seat: Optional[int] = None
        if remainder > 0:
            for i in range(self.player_count):
                s = ((self.dealer_seat - 1 + i) % self.player_count) + 1
                if s in winner_seats:
                    odd_winner_seat = s
                    break

        for wp in winners:
            amt = share + (remainder if wp.seat == odd_winner_seat else 0)
            wp.chip_score += amt

        changes: Dict[int, int] = {}
        for p in self.players.values():
            if p.is_folded:
                changes[p.seat] = -p.fold_orbit
            elif p.seat in winner_seats:
                changes[p.seat] = share + (remainder if p.seat == odd_winner_seat else 0)
            else:
                changes[p.seat] = -base_score
        self.last_score_changes = changes


# ==========================================
# 特征提取（与 TypeScript neuralNet.ts 逐维一致）
# ==========================================

def _has_4_flush_draw(cards: Sequence[int]) -> float:
    counts = [0, 0, 0, 0]
    for c in cards:
        counts[CARD_SUIT_IDX[c]] += 1
    return 1.0 if max(counts) >= 4 else 0.0


def _has_4_straight_draw(cards: Sequence[int]) -> float:
    present = [0] * 15  # 1..14 (1=A-low)
    for c in cards:
        v = CARD_RANK_VAL[c]
        present[v] = 1
        if v == 14:
            present[1] = 1
    for start in range(1, 11):
        cnt = sum(present[start:start + 5])
        if cnt >= 4:
            return 1.0
    return 0.0


def encode_actor_obs(game: DoraHoldemSim, self_seat: int) -> List[float]:
    feats = [0.0] * OBS_ACTOR_DIM
    self_p = game.players[self_seat]
    hole_sorted = game.get_sorted_hole(self_seat)
    board_sorted = game.get_sorted_board()
    exposed_set = set(self_p.exposed_cards)

    # [0..51] my_unexposed, [52..103] my_exposed
    for c in hole_sorted:
        if c in exposed_set:
            feats[52 + c] = 1.0
        else:
            feats[c] = 1.0

    # [104..155] community_cards
    for c in board_sorted:
        feats[104 + c] = 1.0

    # [156..207] public_dead_cards (opponents' exposed + everyone's faceUpDiscards)
    dead_dora = 0
    seen_dead = set()
    for p in game.players.values():
        if p.seat != self_seat:
            for c in p.exposed_cards:
                if c not in seen_dead:
                    seen_dead.add(c)
                    feats[156 + c] = 1.0
                    if CARD_RANK_IDX[c] == game.legal_dora_idx:
                        dead_dora += 1
        for c in p.face_up_discards:
            if c not in seen_dead:
                seen_dead.add(c)
                feats[156 + c] = 1.0
                if CARD_RANK_IDX[c] == game.legal_dora_idx:
                    dead_dora += 1

    # [208..220] legal_dora_rank one-hot
    feats[208 + game.legal_dora_idx] = 1.0

    # 评估自身当前最佳手牌（若弃牌跑路则为空）
    if not self_p.is_folded and len(hole_sorted) + len(board_sorted) >= 5:
        my_eval = find_best_hand(hole_sorted, board_sorted, game.legal_dora_idx)
        my_rank = my_eval[0]
        top_tb = my_eval[1][0] if my_eval[1] else 0
        best5_dora = my_eval[2]
        best5_set = set(my_eval[3])
    else:
        my_eval = None
        my_rank = 1
        top_tb = 0
        best5_dora = 0
        best5_set = set()

    # [221..230] my_best_hand_rank one-hot
    feats[221 + (my_rank - 1)] = 1.0

    my_total_dora = sum(1 for c in hole_sorted if CARD_RANK_IDX[c] == game.legal_dora_idx)
    board_dora = sum(1 for c in board_sorted if CARD_RANK_IDX[c] == game.legal_dora_idx)
    pool_all = hole_sorted + board_sorted

    best_swap_rank_gain = 0
    best_swap_dora_gain = 0
    if not self_p.is_folded and my_eval is not None:
        swappable = [c for c in hole_sorted if c not in exposed_set]
        for h_c in swappable:
            for b_c in board_sorted:
                t_hole = [c for c in hole_sorted if c != h_c] + [b_c]
                t_board = [h_c if c == b_c else c for c in board_sorted]
                t_eval = find_best_hand(t_hole, t_board, game.legal_dora_idx)
                r_diff = t_eval[0] - my_rank
                if r_diff > best_swap_rank_gain:
                    best_swap_rank_gain = r_diff
                if compare_eval(t_eval, my_eval) >= 0:
                    d_diff = t_eval[2] - best5_dora
                    if d_diff > best_swap_dora_gain:
                        best_swap_dora_gain = d_diff

    # [231..246] 16 tactical scalars
    feats[231] = top_tb / 14.0
    feats[232] = best5_dora / 4.0
    feats[233] = my_total_dora / 4.0
    feats[234] = board_dora / 4.0
    feats[235] = dead_dora / 4.0
    feats[236] = (len(hole_sorted) - len(exposed_set)) / 5.0
    feats[237] = len(exposed_set) / 5.0
    feats[238] = _has_4_flush_draw(pool_all)
    feats[239] = _has_4_straight_draw(pool_all)
    feats[240] = min(best_swap_rank_gain, 9) / 9.0
    feats[241] = min(best_swap_dora_gain, 4) / 4.0
    feats[242] = min(game.current_orbit, 20) / 10.0
    feats[243] = min(len(board_sorted), 12) / 8.0
    feats[244] = len(game.draw_pile) / 40.0
    feats[245] = 1.0 if len(game.draw_pile) <= 4 else 0.0
    feats[246] = min(game.current_pot, 40) / 20.0

    # [247..254] 8 table context scalars
    active_count = sum(1 for pl in game.players.values() if not pl.is_folded)
    rel_pos = (self_seat - game.dealer_seat + game.player_count) % game.player_count
    est_base = len(board_sorted) + game.current_orbit + best5_dora
    feats[247] = active_count / 5.0
    feats[248] = game.player_count / 5.0
    feats[249] = rel_pos / 4.0
    feats[250] = 1.0 if self_seat == game.dealer_seat else 0.0
    feats[251] = est_base / 15.0
    feats[252] = game.current_orbit / max(1.0, float(len(board_sorted) + game.current_orbit))
    feats[253] = len(game.discard_pile) / 30.0
    feats[254] = max(-1.0, min(1.0, self_p.chip_score / 30.0))

    # [255..278] 4 opponent public slots (clockwise from self_seat)
    for k in range(4):
        base = 255 + k * 6
        if k < game.player_count - 1:
            opp_seat = ((self_seat - 1 + (k + 1)) % game.player_count) + 1
            op = game.players[opp_seat]
            feats[base + 0] = 1.0
            feats[base + 1] = 0.0 if op.is_folded else 1.0
            feats[base + 2] = 1.0 if op.is_folded else 0.0
            feats[base + 3] = len(op.exposed_cards) / 5.0
            feats[base + 4] = min(len(op.face_up_discards), 10) / 10.0
            feats[base + 5] = sum(1 for c in op.exposed_cards if CARD_RANK_IDX[c] == game.legal_dora_idx) / 4.0

    # [279..298] 5 sorted hole card slot features (4 dims each)
    for i in range(min(len(hole_sorted), MAX_HOLE_SLOTS)):
        c = hole_sorted[i]
        base = 279 + i * 4
        feats[base + 0] = 1.0 if c in best5_set else 0.0
        feats[base + 1] = 1.0 if CARD_RANK_IDX[c] == game.legal_dora_idx else 0.0
        feats[base + 2] = 1.0 if c in exposed_set else 0.0
        feats[base + 3] = CARD_RANK_VAL[c] / 14.0

    # [299..330] 8 sorted board card slot features (4 dims each)
    for b in range(min(len(board_sorted), MAX_BOARD_SLOTS)):
        c = board_sorted[b]
        base = 299 + b * 4
        feats[base + 0] = 1.0
        feats[base + 1] = 1.0 if c in best5_set else 0.0
        feats[base + 2] = 1.0 if CARD_RANK_IDX[c] == game.legal_dora_idx else 0.0
        feats[base + 3] = CARD_RANK_VAL[c] / 14.0

    return feats


def encode_critic_obs(game: DoraHoldemSim, self_seat: int) -> List[float]:
    """上帝视角特征 = Actor 特征 (321) + 对手暗牌与真实胜负特征 (240) = 561"""
    actor_feats = encode_actor_obs(game, self_seat)
    god = [0.0] * OBS_GOD_EXTRA_DIM
    self_p = game.players[self_seat]
    board = game.community_cards

    self_active = (not self_p.is_folded) and len(self_p.hole_cards) > 0
    self_eval = find_best_hand(self_p.hole_cards, board, game.legal_dora_idx) if self_active else None

    active_evals: List[Tuple[int, Tuple[int, Tuple[int, ...], int, Tuple[int, ...]]]] = []
    if self_eval is not None:
        active_evals.append((self_seat, self_eval))

    num_beating = 0
    num_tying = 0
    for k in range(4):
        if k < game.player_count - 1:
            opp_seat = ((self_seat - 1 + (k + 1)) % game.player_count) + 1
            op = game.players[opp_seat]
            if not op.is_folded and len(op.hole_cards) > 0:
                for c in op.hole_cards:
                    god[k * 52 + c] = 1.0
                o_eval = find_best_hand(op.hole_cards, board, game.legal_dora_idx)
                active_evals.append((opp_seat, o_eval))
                base = 208 + k * 6
                god[base + 0] = o_eval[0] / 10.0
                god[base + 1] = (o_eval[1][0] if o_eval[1] else 0) / 14.0
                god[base + 2] = o_eval[2] / 4.0
                if self_eval is not None:
                    cmp = compare_eval(o_eval, self_eval)
                    god[base + 3] = 1.0 if cmp > 0 else 0.0
                    god[base + 4] = 1.0 if cmp == 0 else 0.0
                    god[base + 5] = max(-1.0, min(1.0, (o_eval[0] - self_eval[0]) / 9.0))
                    if cmp > 0:
                        num_beating += 1
                    elif cmp == 0:
                        num_tying += 1

    # [232..239] 上帝真实终局真相
    if self_eval is not None and active_evals:
        best_overall = active_evals[0][1]
        for _, ev in active_evals[1:]:
            if compare_eval(ev, best_overall) > 0:
                best_overall = ev
        winners = [s for s, ev in active_evals if compare_eval(ev, best_overall) == 0]
        winner_dora = max(ev[2] for s, ev in active_evals if s in winners)
        base_score = len(board) + game.current_orbit + winner_dora
        losers_count = len(active_evals) - len(winners)
        total_prize = losers_count * base_score + game.current_pot

        if len(active_evals) == 1:
            true_showdown_ev = float(game.current_pot)
        elif self_seat in winners:
            share = total_prize // len(winners)
            rem = total_prize % len(winners)
            odd_seat = None
            if rem > 0:
                wset = set(winners)
                for i in range(game.player_count):
                    s = ((game.dealer_seat - 1 + i) % game.player_count) + 1
                    if s in wset:
                        odd_seat = s
                        break
            true_showdown_ev = float(share + (rem if self_seat == odd_seat else 0))
        else:
            true_showdown_ev = float(-base_score)

        god[232] = 1.0 if (num_beating == 0 and num_tying == 0) else 0.0
        god[233] = 1.0 if (num_beating == 0 and num_tying > 0) else 0.0
        god[234] = num_beating / 4.0
        god[235] = max(-2.0, min(2.0, true_showdown_ev / 15.0))
        god[236] = max(-2.0, min(2.0, -game.current_orbit / 15.0))
        god[237] = winner_dora / 4.0

        if len(game.draw_pile) > 0:
            top_c = game.draw_pile[0]
            god[238] = 1.0 if CARD_RANK_IDX[top_c] == game.legal_dora_idx else 0.0
            t_eval = find_best_hand(self_p.hole_cards, board + [top_c], game.legal_dora_idx)
            god[239] = 1.0 if compare_eval(t_eval, self_eval) > 0 else 0.0
    else:
        god[235] = max(-2.0, min(2.0, -self_p.fold_orbit / 15.0))
        god[236] = max(-2.0, min(2.0, -game.current_orbit / 15.0))

    return actor_feats + god


# 启发式对手（供训练初期与评测对比基准使用）
def heuristic_bot_action(game: DoraHoldemSim, seat: int, rng: random.Random) -> int:
    mask = game.get_legal_action_mask(seat)
    p = game.players[seat]
    hole = game.get_sorted_hole(seat)
    board = game.get_sorted_board()
    exposed_set = set(p.exposed_cards)
    my_eval = find_best_hand(hole, board, game.legal_dora_idx)

    if my_eval[0] >= THREE_OF_A_KIND and game.current_orbit >= 2:
        return ACT_CALL_SHOWDOWN

    # 尝试有益 Swap
    best_swap = None
    for b_idx, b_c in enumerate(board[:MAX_BOARD_SLOTS]):
        for h_idx, h_c in enumerate(hole):
            if h_c in exposed_set:
                continue
            act_id = ACT_SWAP_OFFSET + h_idx * MAX_BOARD_SLOTS + b_idx
            if not mask[act_id]:
                continue
            t_hole = [c for c in hole if c != h_c] + [b_c]
            t_board = [h_c if c == b_c else c for c in board]
            t_eval = find_best_hand(t_hole, t_board, game.legal_dora_idx)
            cmp = compare_eval(t_eval, my_eval)
            if cmp > 0 or (cmp == 0 and t_eval[2] > my_eval[2]):
                score = t_eval[0] * 100 + t_eval[2] * 10
                if best_swap is None or score > best_swap[0]:
                    best_swap = (score, act_id)
    if best_swap is not None:
        return best_swap[1]

    if game.current_orbit >= 2 and my_eval[0] == HIGH_CARD and my_eval[2] == 0 and rng.random() < 0.7:
        return ACT_FOLD

    # 丢掉不在最佳成牌且非宝牌的牌
    best_set = set(my_eval[3])
    useless_indices = [
        i for i, c in enumerate(hole)
        if c not in best_set and CARD_RANK_IDX[c] != game.legal_dora_idx
    ]
    if len(useless_indices) >= 2:
        act_id = DISCARD2_LOOKUP.get((useless_indices[0], useless_indices[1]))
        if act_id is not None and mask[act_id]:
            return act_id
    if len(useless_indices) == 1:
        act_id = ACT_DISCARD1_OFFSET + useless_indices[0]
        if mask[act_id]:
            return act_id

    if len(board) <= 2 and mask[ACT_EXPAND_BOARD]:
        return ACT_EXPAND_BOARD

    if my_eval[0] >= TWO_PAIR or game.current_orbit >= 3:
        return ACT_CALL_SHOWDOWN

    legal = [idx for idx, m in enumerate(mask) if m == 1]
    return rng.choice(legal)
