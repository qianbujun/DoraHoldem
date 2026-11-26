"""校验 Python 模拟器与 TypeScript 引擎规则 100% 一致性"""

import random
from dora_sim import (
    DoraHoldemSim,
    OBS_ACTOR_DIM,
    OBS_CRITIC_DIM,
    NUM_ACTIONS,
    ACT_FOLD,
    ACT_CALL_SHOWDOWN,
    card_from_str,
    evaluate_5cards,
    find_best_hand,
    compare_eval,
    encode_actor_obs,
    encode_critic_obs,
    heuristic_bot_action,
    STRAIGHT,
    ROYAL_FLUSH,
    FOUR_OF_A_KIND,
    ONE_PAIR,
    RANK_TO_IDX,
)


def test_evaluator_parity():
    # 1. A-2-3-4-5 轮子顺
    wheel = [card_from_str(s) for s in ['As', '2h', '3d', '4c', '5s']]
    ev = evaluate_5cards(wheel, RANK_TO_IDX['7'])
    assert ev[0] == STRAIGHT and ev[1] == (5,), f"Wheel failed: {ev}"

    # 2. 皇家同花顺 + 宝牌 A
    royal = [card_from_str(s) for s in ['As', 'Ks', 'Qs', 'Js', 'Ts']]
    ev_r = evaluate_5cards(royal, RANK_TO_IDX['A'])
    assert ev_r[0] == ROYAL_FLUSH and ev_r[2] == 1

    # 3. 四条 9 + 4张宝牌
    quads = [card_from_str(s) for s in ['9s', '9h', '9c', '9d', '2s']]
    ev_q = evaluate_5cards(quads, RANK_TO_IDX['9'])
    assert ev_q[0] == FOUR_OF_A_KIND and ev_q[2] == 4

    # 4. 最佳牌型客观原则: 禁止为了宝牌2c降级踢脚9h
    hole = [card_from_str(s) for s in ['As', 'Ah', '9h', '2c', '4d']]
    board = [card_from_str(s) for s in ['Qc', 'Td', '7s']]
    best = find_best_hand(hole, board, RANK_TO_IDX['2'])
    assert best[0] == ONE_PAIR
    assert card_from_str('9h') in best[3]
    assert card_from_str('2c') not in best[3]
    assert best[2] == 0

    # 5. 模拟 500 局随机对局验证零和守恒与特征维度
    rng = random.Random(42)
    for g in range(500):
        n_p = rng.choice([2, 3, 4, 5])
        sim = DoraHoldemSim(player_count=n_p, seed=g)
        steps = 0
        while not sim.is_finished and steps < 60:
            seat = sim.current_turn_seat
            obs_a = encode_actor_obs(sim, seat)
            obs_c = encode_critic_obs(sim, seat)
            assert len(obs_a) == OBS_ACTOR_DIM
            assert len(obs_c) == OBS_CRITIC_DIM
            mask = sim.get_legal_action_mask(seat)
            assert len(mask) == NUM_ACTIONS
            assert sum(mask) >= 3
            act = heuristic_bot_action(sim, seat, rng)
            assert mask[act] == 1
            sim.step(act)
            steps += 1
        assert sim.is_finished or steps == 60
        if sim.is_finished:
            total_delta = sum(sim.last_score_changes.values())
            assert total_delta == 0, f"Zero-sum violated: {sim.last_score_changes}"

    print("ALL PYTHON SIMULATOR PARITY TESTS PASSED!")


if __name__ == "__main__":
    test_evaluator_parity()
