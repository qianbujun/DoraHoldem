"""
宿命公牌 (Dora Hold'em) - 20万局多进程并行 非对称 Actor-Critic PPO (Asymmetric PPO) 自博弈训练脚本
核心特性:
1. 全面覆盖 2人、3人、4人、5人 差异化博弈策略 (均等采样 25% each, 显式人数+活跃对手数+摸空压力+多人底池赔率特征);
2. 12 进程并行高速自博弈采样 + CUDA GPU 小批量梯度更新，训练总量超过 200,000 局;
3. 非对称架构: Actor 仅看正常玩家视角 (341维), Critic 开上帝视角 (581维), 训练结束后导出:
   - ActorPolicyNet (用于中级/高级/终极先验)
   - PartialValueNet (用于高级局部估值)
   - GodCriticNet (用于终极 AI 的 PIMC 平行世界 1 步前瞻估值)
"""

from __future__ import annotations

import copy
import json
import multiprocessing as mp
import random
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from dora_sim import (
    DoraHoldemSim,
    NUM_ACTIONS,
    OBS_ACTOR_DIM,
    OBS_CRITIC_DIM,
    encode_actor_obs,
    encode_critic_obs,
    heuristic_bot_action,
    ACT_CALL_SHOWDOWN,
    ACT_FOLD,
    ACT_EXPAND_BOARD,
    ACT_DISCARD1_OFFSET,
    ACT_SWAP_OFFSET,
    ACT_BANISH_OFFSET,
    find_best_hand,
    compare_eval,
    ALL_CARDS,
    CARD_RANK_IDX,
    CARD_RANK_VAL,
    DISCARD2_LOOKUP,
    MAX_BOARD_SLOTS,
)

REWARD_SCALE = 10.0


class ActorPolicyNet(nn.Module):
    def __init__(self, obs_dim: int = OBS_ACTOR_DIM, hidden: int = 256, num_actions: int = NUM_ACTIONS):
        super().__init__()
        self.fc1 = nn.Linear(obs_dim, hidden)
        self.fc2 = nn.Linear(hidden, hidden)
        self.logits = nn.Linear(hidden, num_actions)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.fc1(x))
        h = F.relu(self.fc2(h))
        return self.logits(h)


class ValueMLP(nn.Module):
    def __init__(self, obs_dim: int, h1: int = 128, h2: int = 64):
        super().__init__()
        self.fc1 = nn.Linear(obs_dim, h1)
        self.fc2 = nn.Linear(h1, h2)
        self.out = nn.Linear(h2, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.fc1(x))
        h = F.relu(self.fc2(h))
        return self.out(h).squeeze(-1)


def masked_categorical(logits: torch.Tensor, mask: torch.Tensor) -> torch.distributions.Categorical:
    masked_logits = logits.masked_fill(mask <= 0.5, -1e9)
    return torch.distributions.Categorical(logits=masked_logits)


def compute_gae(
    rewards: List[float],
    values: List[float],
    dones: List[bool],
    gamma: float = 0.99,
    lam: float = 0.95,
) -> Tuple[List[float], List[float]]:
    n = len(rewards)
    advantages = [0.0] * n
    returns = [0.0] * n
    gae = 0.0
    next_val = 0.0
    for t in reversed(range(n)):
        non_terminal = 0.0 if dones[t] else 1.0
        delta = rewards[t] + gamma * next_val * non_terminal - values[t]
        gae = delta + gamma * lam * non_terminal * gae
        advantages[t] = gae
        returns[t] = gae + values[t]
        next_val = values[t]
    return advantages, returns


def strong_teacher_action(sim: DoraHoldemSim, seat: int, rng: random.Random) -> int:
    """
    适应不同人数的强教师策略:
    - 2人单挑: 放宽成牌开牌阈值，极少早弃
    - 3人局: 平衡做牌与偷取公牌宝牌
    - 4~5人多人桌: 注重高牌力要求、宝牌阻断、公牌扩张赔率与摸空猝死边界
    """
    mask = sim.get_legal_action_mask(seat)
    p = sim.players[seat]
    hole = sim.get_sorted_hole(seat)
    board = sim.get_sorted_board()
    exposed_set = set(p.exposed_cards)
    my_eval = find_best_hand(hole, board, sim.legal_dora_idx)

    dead = set(hole) | set(board)
    for pl in sim.players.values():
        dead.update(pl.exposed_cards)
        dead.update(pl.face_up_discards)
    unseen = [c for c in ALL_CARDS if c not in dead]
    active_opps = sum(1 for pl in sim.players.values() if not pl.is_folded and pl.seat != seat)
    if active_opps <= 0:
        return ACT_CALL_SHOWDOWN

    wins = 0.0
    sims = 20
    if len(unseen) >= active_opps * 5:
        for _ in range(sims):
            sample = rng.sample(unseen, active_opps * 5)
            beat_all = True
            tied = 0
            for k in range(active_opps):
                oh = sample[k * 5:(k + 1) * 5]
                oe = find_best_hand(oh, board, sim.legal_dora_idx)
                cmp = compare_eval(oe, my_eval)
                if cmp > 0:
                    beat_all = False
                    break
                elif cmp == 0:
                    tied += 1
            if beat_all:
                wins += 1.0 / (1 + tied)
        win_rate = wins / sims
    else:
        win_rate = 0.5

    est_base = len(board) + sim.current_orbit + my_eval[2]
    win_pot = active_opps * est_base + sim.current_pot
    showdown_ev = win_rate * win_pot - (1.0 - win_rate) * est_base
    fold_ev = -float(sim.current_orbit)

    # 随活跃对手数动态调整决战/跑路阈值
    if active_opps == 1:
        # 2人局单挑
        showdown_wr_thresh = 0.62
        fold_wr_thresh = 0.22
        fold_min_orbit = 3
    elif active_opps == 2:
        # 3人局
        showdown_wr_thresh = 0.56
        fold_wr_thresh = 0.20
        fold_min_orbit = 2
    else:
        # 4~5人多人桌
        showdown_wr_thresh = 0.46 if active_opps >= 3 else 0.50
        fold_wr_thresh = 0.16 if active_opps == 3 else 0.14
        fold_min_orbit = 2

    # 若牌堆即将摸空（下一圈回不来就触发猝死），根据即时 EV 果断决战或跑路
    imminent_depletion = len(sim.draw_pile) <= active_opps * 2 + 1
    if imminent_depletion:
        if showdown_ev > fold_ev + 0.5 and win_rate >= (1.0 / (active_opps + 1)):
            return ACT_CALL_SHOWDOWN
        if sim.current_orbit >= 2 and fold_ev > showdown_ev + 0.5:
            return ACT_FOLD

    if win_rate >= showdown_wr_thresh or (showdown_ev > 3.2 and sim.current_orbit >= 2):
        return ACT_CALL_SHOWDOWN

    if win_rate < fold_wr_thresh and sim.current_orbit >= fold_min_orbit and fold_ev > showdown_ev - 0.3:
        return ACT_FOLD

    # 寻找能抢走公区宝牌或用手中废牌置换公区大牌阻断对手的 Swap
    best_swap = None
    best_set = set(my_eval[3])
    for b_idx, b_c in enumerate(board[:MAX_BOARD_SLOTS]):
        b_is_dora = CARD_RANK_IDX[b_c] == sim.legal_dora_idx
        b_val = CARD_RANK_VAL[b_c]
        for h_idx, h_c in enumerate(hole):
            if h_c in exposed_set:
                continue
            act_id = ACT_SWAP_OFFSET + h_idx * MAX_BOARD_SLOTS + b_idx
            if not mask[act_id]:
                continue
            h_is_dora = CARD_RANK_IDX[h_c] == sim.legal_dora_idx
            h_val = CARD_RANK_VAL[h_c]
            if h_is_dora:
                continue
            # 抢宝牌或抢大牌阻断（多人桌价值更高）
            steal_score = 0
            if b_is_dora:
                steal_score += 120 + active_opps * 25
            elif b_val >= 11 and h_val <= 7 and h_c not in best_set:
                steal_score += (b_val - h_val) * 6 + active_opps * 8
            if steal_score > 0:
                if best_swap is None or steal_score > best_swap[0]:
                    best_swap = (steal_score, act_id)
    if best_swap is not None and (best_swap[0] >= 120 or rng.random() < 0.70):
        return best_swap[1]

    # 多人桌持强牌/宝牌/听牌时适度加注扩充公牌
    expand_prob = 0.25 if active_opps == 1 else (0.38 if active_opps == 2 else 0.48)
    if len(board) < 4 and len(sim.draw_pile) >= 2 and (my_eval[0] >= 2 or win_rate > 0.35) and rng.random() < expand_prob:
        if mask[ACT_EXPAND_BOARD]:
            return ACT_EXPAND_BOARD

    if len(board) >= 2 and len(sim.draw_pile) >= 2 and rng.random() < (0.14 + 0.03 * active_opps):
        for b_idx, b_c in enumerate(board[:MAX_BOARD_SLOTS]):
            if CARD_RANK_IDX[b_c] != sim.legal_dora_idx and b_c not in best_set:
                act_id = ACT_BANISH_OFFSET + b_idx
                if mask[act_id]:
                    return act_id

    candidates = [
        (CARD_RANK_VAL[c], i)
        for i, c in enumerate(hole)
        if c not in best_set and CARD_RANK_IDX[c] != sim.legal_dora_idx
    ]
    candidates.sort()
    if len(candidates) >= 2:
        act_id = DISCARD2_LOOKUP.get((candidates[0][1], candidates[1][1]))
        if act_id is not None and mask[act_id]:
            return act_id
    elif len(candidates) == 1:
        act_id = ACT_DISCARD1_OFFSET + candidates[0][1]
        if mask[act_id]:
            return act_id

    if len(board) < 5 and mask[ACT_EXPAND_BOARD]:
        return ACT_EXPAND_BOARD

    return ACT_CALL_SHOWDOWN


def builder_bot_action(sim: DoraHoldemSim, seat: int, rng: random.Random) -> int:
    mask = sim.get_legal_action_mask(seat)
    hole = sim.get_sorted_hole(seat)
    board = sim.get_sorted_board()
    my_eval = find_best_hand(hole, board, sim.legal_dora_idx)
    active_opps = sum(1 for pl in sim.players.values() if not pl.is_folded and pl.seat != seat)
    if sim.current_orbit >= (3 if active_opps == 1 else 2) and my_eval[0] <= (1 if active_opps == 1 else 2) and my_eval[2] == 0 and rng.random() < 0.65:
        return ACT_FOLD
    if len(board) < 4 and mask[ACT_EXPAND_BOARD] and rng.random() < 0.50:
        return ACT_EXPAND_BOARD
    return strong_teacher_action(sim, seat, rng)


# ==========================================
# 多进程 Worker：每个进程独立在 CPU 上高速推演对局
# ==========================================
_W_ACTOR: Optional[ActorPolicyNet] = None
_W_CRITIC: Optional[ValueMLP] = None
_W_POOL: List[ActorPolicyNet] = []


def _worker_init():
    global _W_ACTOR, _W_CRITIC, _W_POOL
    torch.set_num_threads(1)
    _W_ACTOR = ActorPolicyNet()
    _W_CRITIC = ValueMLP(OBS_CRITIC_DIM, 128, 64)
    _W_POOL = []


def _run_rollout_worker(args):
    global _W_ACTOR, _W_CRITIC, _W_POOL
    seed, num_episodes, actor_sd, critic_sd, pool_sds, rollout_temp = args
    assert _W_ACTOR is not None and _W_CRITIC is not None

    _W_ACTOR.load_state_dict(actor_sd)
    _W_CRITIC.load_state_dict(critic_sd)
    _W_ACTOR.eval()
    _W_CRITIC.eval()

    while len(_W_POOL) < len(pool_sds):
        net = ActorPolicyNet()
        net.eval()
        _W_POOL.append(net)
    for i, sd in enumerate(pool_sds):
        _W_POOL[i].load_state_dict(sd)

    rng = random.Random(seed)
    all_obs_a, all_obs_c, all_masks, all_acts, all_logps, all_advs, all_rets = (
        [], [], [], [], [], [], []
    )

    with torch.no_grad():
        for e in range(num_episodes):
            # 严格均衡覆盖 2 / 3 / 4 / 5 人对局
            n_p = [2, 3, 4, 5][e % 4]
            sim = DoraHoldemSim(player_count=n_p, seed=seed * 1000 + e)

            # 座位策略分配：保证至少 1 个训练位，其余混合 self / pool / teacher / builder / heur
            modes: Dict[int, Tuple[str, int]] = {}
            train_seat = rng.randint(1, n_p)
            for s in range(1, n_p + 1):
                if s == train_seat:
                    modes[s] = ("self", -1)
                else:
                    r = rng.random()
                    if r < 0.52:
                        modes[s] = ("self", -1)
                    elif r < 0.72 and len(pool_sds) > 0:
                        modes[s] = ("pool", rng.randrange(len(pool_sds)))
                    elif r < 0.85:
                        modes[s] = ("teacher", -1)
                    elif r < 0.93:
                        modes[s] = ("builder", -1)
                    else:
                        modes[s] = ("heur", -1)

            trajs = {
                s: {"obs_a": [], "obs_c": [], "mask": [], "act": [], "logp": [], "v_god": [], "rew": [], "done": []}
                for s in range(1, n_p + 1)
                if modes[s][0] == "self"
            }

            steps = 0
            while not sim.is_finished and steps < 45:
                seat = sim.current_turn_seat
                mode, p_idx = modes[seat]
                if mode == "heur":
                    act = heuristic_bot_action(sim, seat, rng)
                    sim.step(act)
                elif mode == "teacher":
                    act = strong_teacher_action(sim, seat, rng)
                    sim.step(act)
                elif mode == "builder":
                    act = builder_bot_action(sim, seat, rng)
                    sim.step(act)
                elif mode == "pool":
                    obs_a = encode_actor_obs(sim, seat)
                    mask = sim.get_legal_action_mask(seat)
                    oa_t = torch.tensor([obs_a], dtype=torch.float32)
                    m_t = torch.tensor([mask], dtype=torch.float32)
                    logits = _W_POOL[p_idx](oa_t) / 0.8
                    dist = masked_categorical(logits, m_t)
                    act = int(dist.sample().item())
                    sim.step(act)
                else:
                    obs_a = encode_actor_obs(sim, seat)
                    obs_c = encode_critic_obs(sim, seat, precomputed_actor=obs_a)
                    mask = sim.get_legal_action_mask(seat)
                    oa_t = torch.tensor([obs_a], dtype=torch.float32)
                    oc_t = torch.tensor([obs_c], dtype=torch.float32)
                    m_t = torch.tensor([mask], dtype=torch.float32)
                    logits = _W_ACTOR(oa_t) / rollout_temp
                    dist = masked_categorical(logits, m_t)
                    act_t = dist.sample()
                    act = int(act_t.item())
                    logp = float(dist.log_prob(act_t).item())
                    v_god = float(_W_CRITIC(oc_t).item())

                    buf = trajs[seat]
                    buf["obs_a"].append(obs_a)
                    buf["obs_c"].append(obs_c)
                    buf["mask"].append(mask)
                    buf["act"].append(act)
                    buf["logp"].append(logp)
                    buf["v_god"].append(v_god)

                    was_folded = sim.players[seat].is_folded
                    finished, _ = sim.step(act)
                    if sim.players[seat].is_folded and not was_folded and not finished:
                        buf["rew"].append(-sim.players[seat].fold_orbit / REWARD_SCALE)
                        buf["done"].append(True)
                    else:
                        buf["rew"].append(0.0)
                        buf["done"].append(False)
                steps += 1

            if not sim.is_finished:
                sim.step(ACT_CALL_SHOWDOWN)

            for seat, buf in trajs.items():
                if not buf["act"]:
                    continue
                if not buf["done"][-1]:
                    buf["rew"][-1] = sim.last_score_changes[seat] / REWARD_SCALE
                    buf["done"][-1] = True
                adv, ret = compute_gae(buf["rew"], buf["v_god"], buf["done"])
                all_obs_a.extend(buf["obs_a"])
                all_obs_c.extend(buf["obs_c"])
                all_masks.extend(buf["mask"])
                all_acts.extend(buf["act"])
                all_logps.extend(buf["logp"])
                all_advs.extend(adv)
                all_rets.extend(ret)

    return (
        np.asarray(all_obs_a, dtype=np.float32),
        np.asarray(all_obs_c, dtype=np.float32),
        np.asarray(all_masks, dtype=np.float32),
        np.asarray(all_acts, dtype=np.int64),
        np.asarray(all_logps, dtype=np.float32),
        np.asarray(all_advs, dtype=np.float32),
        np.asarray(all_rets, dtype=np.float32),
    )


def _warmstart_worker(args):
    seed, num_games = args
    rng = random.Random(seed)
    obs_a_all, obs_c_all, mask_all, act_all, ret_all = [], [], [], [], []
    for g in range(num_games):
        n_p = [2, 3, 4, 5][g % 4]
        sim = DoraHoldemSim(player_count=n_p, seed=seed * 1000 + g)
        ep_items = []
        steps = 0
        while not sim.is_finished and steps < 45:
            seat = sim.current_turn_seat
            obs_a = encode_actor_obs(sim, seat)
            obs_c = encode_critic_obs(sim, seat, precomputed_actor=obs_a)
            mask = sim.get_legal_action_mask(seat)
            r_mode = rng.random()
            if r_mode < 0.65:
                act = strong_teacher_action(sim, seat, rng)
            elif r_mode < 0.85:
                act = builder_bot_action(sim, seat, rng)
            else:
                act = heuristic_bot_action(sim, seat, rng)
            ep_items.append((seat, obs_a, obs_c, mask, act))
            sim.step(act)
            steps += 1
        if not sim.is_finished:
            sim.step(ACT_CALL_SHOWDOWN)
        for seat, oa, oc, m, a in ep_items:
            obs_a_all.append(oa)
            obs_c_all.append(oc)
            mask_all.append(m)
            act_all.append(a)
            ret_all.append(sim.last_score_changes[seat] / REWARD_SCALE)
    return (
        np.asarray(obs_a_all, dtype=np.float32),
        np.asarray(obs_c_all, dtype=np.float32),
        np.asarray(mask_all, dtype=np.float32),
        np.asarray(act_all, dtype=np.int64),
        np.asarray(ret_all, dtype=np.float32),
    )


@torch.no_grad()
def evaluate_by_player_count(
    actor: ActorPolicyNet,
    device: torch.device,
    opponent_fn,
    games_per_count: int = 200,
    seed: int = 12345,
) -> Dict[int, Tuple[float, float]]:
    """按 2人 / 3人 / 4人 / 5人 分别统计平均净胜分与胜率"""
    rng = random.Random(seed)
    actor.eval()
    results: Dict[int, Tuple[float, float]] = {}
    for n_p in [2, 3, 4, 5]:
        total_score = 0.0
        wins = 0
        for g in range(games_per_count):
            ai_seat = (g % n_p) + 1
            sim = DoraHoldemSim(player_count=n_p, seed=seed + n_p * 10000 + g)
            steps = 0
            while not sim.is_finished and steps < 45:
                seat = sim.current_turn_seat
                if seat == ai_seat:
                    obs = encode_actor_obs(sim, seat)
                    mask = sim.get_legal_action_mask(seat)
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)
                    mask_t = torch.tensor([mask], dtype=torch.float32, device=device)
                    logits = actor(obs_t).masked_fill(mask_t <= 0.5, -1e9)
                    act = int(torch.argmax(logits, dim=-1).item())
                else:
                    act = opponent_fn(sim, seat, rng)
                sim.step(act)
                steps += 1
            if not sim.is_finished:
                sim.step(ACT_CALL_SHOWDOWN)
            delta = sim.last_score_changes[ai_seat]
            total_score += delta
            if delta > 0:
                wins += 1
        results[n_p] = (total_score / games_per_count, wins / games_per_count)
    actor.train()
    return results


def export_weights_json(
    actor: ActorPolicyNet,
    partial_val: ValueMLP,
    god_critic: ValueMLP,
    out_path: Path,
    meta: Dict,
) -> None:
    def dump_mlp(layers: List[nn.Linear]) -> List[Dict]:
        result = []
        for layer in layers:
            w = layer.weight.detach().cpu().numpy()
            b = layer.bias.detach().cpu().numpy()
            result.append({
                "in": int(w.shape[1]),
                "out": int(w.shape[0]),
                "w": [round(float(x), 5) for x in w.reshape(-1)],
                "b": [round(float(x), 5) for x in b.reshape(-1)],
            })
        return result

    payload = {
        "version": 2,
        "obsActorDim": OBS_ACTOR_DIM,
        "obsCriticDim": OBS_CRITIC_DIM,
        "numActions": NUM_ACTIONS,
        "rewardScale": REWARD_SCALE,
        "meta": meta,
        "actorLayers": dump_mlp([actor.fc1, actor.fc2, actor.logits]),
        "partialValueLayers": dump_mlp([partial_val.fc1, partial_val.fc2, partial_val.out]),
        "godValueLayers": dump_mlp([god_critic.fc1, god_critic.fc2, god_critic.out]),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_kb = out_path.stat().st_size / 1024.0
    print(f"[Export] Saved weights to {out_path} ({size_kb:.1f} KB)")


def state_dict_cpu(model: nn.Module) -> Dict[str, torch.Tensor]:
    return {k: v.detach().cpu() for k, v in model.state_dict().items()}


def train(
    num_updates: int = 200,
    episodes_per_update: int = 1008,  # 200 * 1008 = 201,600 hands (> 20万局)
    num_workers: int = 12,
    ppo_epochs: int = 4,
    batch_size: int = 1024,
    lr: float = 2.0e-4,
    warmstart_games: int = 4800,
    out_weights: str = "../server/src/engine/ai_weights.json",
):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    total_ppo_hands = num_updates * episodes_per_update
    print(
        f"[Train] Device={device}, workers={num_workers}, "
        f"updates={num_updates}, episodes/update={episodes_per_update}, "
        f"total_hands={total_ppo_hands + warmstart_games:,} (PPO={total_ppo_hands:,}, BC={warmstart_games:,})"
    )

    actor = ActorPolicyNet().to(device)
    partial_val = ValueMLP(OBS_ACTOR_DIM, 128, 64).to(device)
    god_critic = ValueMLP(OBS_CRITIC_DIM, 128, 64).to(device)

    t0 = time.time()
    ctx = mp.get_context("spawn")

    with ProcessPoolExecutor(max_workers=num_workers, mp_context=ctx, initializer=_worker_init) as pool:
        if warmstart_games > 0:
            per_w = max(1, warmstart_games // num_workers)
            w_tasks = [(80000 + i, per_w) for i in range(num_workers)]
            chunks = list(pool.map(_warmstart_worker, w_tasks))
            oa_t = torch.from_numpy(np.concatenate([c[0] for c in chunks], axis=0)).to(device)
            oc_t = torch.from_numpy(np.concatenate([c[1] for c in chunks], axis=0)).to(device)
            m_t = torch.from_numpy(np.concatenate([c[2] for c in chunks], axis=0)).to(device)
            a_t = torch.from_numpy(np.concatenate([c[3] for c in chunks], axis=0)).to(device)
            r_t = torch.from_numpy(np.concatenate([c[4] for c in chunks], axis=0)).to(device)

            opt_a = torch.optim.Adam(actor.parameters(), lr=8e-4)
            opt_p = torch.optim.Adam(partial_val.parameters(), lr=1e-3)
            opt_c = torch.optim.Adam(god_critic.parameters(), lr=1e-3)
            n_bc = oa_t.shape[0]
            for _ in range(8):
                perm = torch.randperm(n_bc, device=device)
                for start in range(0, n_bc, batch_size):
                    mb = perm[start:start + batch_size]
                    logits = actor(oa_t[mb]).masked_fill(m_t[mb] <= 0.5, -1e9)
                    ce = F.cross_entropy(logits, a_t[mb], label_smoothing=0.08)
                    opt_a.zero_grad()
                    ce.backward()
                    opt_a.step()

                    lp = F.smooth_l1_loss(partial_val(oa_t[mb]), r_t[mb])
                    opt_p.zero_grad()
                    lp.backward()
                    opt_p.step()

                    lc = F.smooth_l1_loss(god_critic(oc_t[mb]), r_t[mb])
                    opt_c.zero_grad()
                    lc.backward()
                    opt_c.step()

            res_h = evaluate_by_player_count(actor, device, heuristic_bot_action, games_per_count=120, seed=1111)
            avg_h = sum(v[0] for v in res_h.values()) / 4.0
            print(f"[Warmstart] {n_bc:,} transitions | vs_heur avg={avg_h:+.3f} (2P:{res_h[2][0]:+.2f}, 3P:{res_h[3][0]:+.2f}, 4P:{res_h[4][0]:+.2f}, 5P:{res_h[5][0]:+.2f})")

        actor_opt = torch.optim.Adam(actor.parameters(), lr=lr)
        pval_opt = torch.optim.Adam(partial_val.parameters(), lr=lr * 1.5)
        critic_opt = torch.optim.Adam(god_critic.parameters(), lr=lr * 1.5)

        opponent_pool_sds: List[Dict[str, torch.Tensor]] = [state_dict_cpu(actor)]
        best_score = -1e9
        best_state = (
            copy.deepcopy(actor.state_dict()),
            copy.deepcopy(partial_val.state_dict()),
            copy.deepcopy(god_critic.state_dict()),
        )

        per_worker_eps = max(4, episodes_per_update // num_workers)

        for update in range(1, num_updates + 1):
            a_sd = state_dict_cpu(actor)
            c_sd = state_dict_cpu(god_critic)
            rollout_temp = max(1.02, 1.15 - 0.13 * (update / num_updates))

            worker_args = [
                (update * 1000 + w, per_worker_eps, a_sd, c_sd, opponent_pool_sds, rollout_temp)
                for w in range(num_workers)
            ]
            chunks = list(pool.map(_run_rollout_worker, worker_args))

            obs_a_arr = torch.from_numpy(np.concatenate([c[0] for c in chunks if len(c[0]) > 0], axis=0)).to(device)
            obs_c_arr = torch.from_numpy(np.concatenate([c[1] for c in chunks if len(c[1]) > 0], axis=0)).to(device)
            mask_arr = torch.from_numpy(np.concatenate([c[2] for c in chunks if len(c[2]) > 0], axis=0)).to(device)
            act_arr = torch.from_numpy(np.concatenate([c[3] for c in chunks if len(c[3]) > 0], axis=0)).to(device)
            old_logp_arr = torch.from_numpy(np.concatenate([c[4] for c in chunks if len(c[4]) > 0], axis=0)).to(device)
            adv_arr = torch.from_numpy(np.concatenate([c[5] for c in chunks if len(c[5]) > 0], axis=0)).to(device)
            ret_arr = torch.from_numpy(np.concatenate([c[6] for c in chunks if len(c[6]) > 0], axis=0)).to(device)

            adv_norm = (adv_arr - adv_arr.mean()) / (adv_arr.std() + 1e-8)

            actor.train()
            partial_val.train()
            god_critic.train()

            n_samples = obs_a_arr.shape[0]
            ent_coef = max(0.010, 0.040 * (1.0 - update / num_updates))

            # 余弦退火学习率
            cur_lr = lr * (0.25 + 0.75 * 0.5 * (1.0 + np.cos(np.pi * update / num_updates)))
            for pg in actor_opt.param_groups:
                pg["lr"] = float(cur_lr)

            for _ in range(ppo_epochs):
                perm = torch.randperm(n_samples, device=device)
                for start in range(0, n_samples, batch_size):
                    mb = perm[start:start + batch_size]
                    logits = actor(obs_a_arr[mb])
                    dist = masked_categorical(logits, mask_arr[mb])
                    new_logp = dist.log_prob(act_arr[mb])
                    entropy = dist.entropy().mean()

                    ratio = torch.exp(new_logp - old_logp_arr[mb])
                    surr1 = ratio * adv_norm[mb]
                    surr2 = torch.clamp(ratio, 0.8, 1.2) * adv_norm[mb]
                    policy_loss = -torch.min(surr1, surr2).mean() - ent_coef * entropy

                    actor_opt.zero_grad()
                    policy_loss.backward()
                    nn.utils.clip_grad_norm_(actor.parameters(), 0.5)
                    actor_opt.step()

                    critic_loss = F.smooth_l1_loss(god_critic(obs_c_arr[mb]), ret_arr[mb])
                    critic_opt.zero_grad()
                    critic_loss.backward()
                    nn.utils.clip_grad_norm_(god_critic.parameters(), 0.5)
                    critic_opt.step()

                    pval_loss = F.smooth_l1_loss(partial_val(obs_a_arr[mb]), ret_arr[mb])
                    pval_opt.zero_grad()
                    pval_loss.backward()
                    nn.utils.clip_grad_norm_(partial_val.parameters(), 0.5)
                    pval_opt.step()

            if update % 15 == 0:
                opponent_pool_sds.append(state_dict_cpu(actor))
                if len(opponent_pool_sds) > 8:
                    opponent_pool_sds.pop(0)

            if update == 1 or update % 25 == 0 or update == num_updates:
                hands_done = update * num_workers * per_worker_eps + warmstart_games
                res_h = evaluate_by_player_count(actor, device, heuristic_bot_action, games_per_count=150, seed=9000 + update)
                res_t = evaluate_by_player_count(actor, device, strong_teacher_action, games_per_count=150, seed=19000 + update)
                avg_h = sum(v[0] for v in res_h.values()) / 4.0
                avg_t = sum(v[0] for v in res_t.values()) / 4.0
                combined = 0.45 * avg_h + 0.55 * avg_t
                elapsed = time.time() - t0
                print(
                    f"[Upd {update:3d}/{num_updates} | {hands_done:6,d} hands] "
                    f"samples={n_samples:5d} | "
                    f"vs_heur={avg_h:+.3f} (2P:{res_h[2][0]:+.2f},3P:{res_h[3][0]:+.2f},4P:{res_h[4][0]:+.2f},5P:{res_h[5][0]:+.2f}) | "
                    f"vs_mc={avg_t:+.3f} (2P:{res_t[2][0]:+.2f},3P:{res_t[3][0]:+.2f},4P:{res_t[4][0]:+.2f},5P:{res_t[5][0]:+.2f}) | "
                    f"{elapsed:.1f}s"
                )
                if combined > best_score:
                    best_score = combined
                    best_state = (
                        copy.deepcopy(actor.state_dict()),
                        copy.deepcopy(partial_val.state_dict()),
                        copy.deepcopy(god_critic.state_dict()),
                    )

    actor.load_state_dict(best_state[0])
    partial_val.load_state_dict(best_state[1])
    god_critic.load_state_dict(best_state[2])

    final_h = evaluate_by_player_count(actor, device, heuristic_bot_action, games_per_count=400, seed=77777)
    final_t = evaluate_by_player_count(actor, device, strong_teacher_action, games_per_count=400, seed=88888)
    print("\n=== Final Evaluation (400 hands per player count = 1,600 hands each) ===")
    for np_cnt in [2, 3, 4, 5]:
        print(
            f"  {np_cnt}P: vs_heur={final_h[np_cnt][0]:+.3f} ({final_h[np_cnt][1]*100:.1f}%) | "
            f"vs_mc_teacher={final_t[np_cnt][0]:+.3f} ({final_t[np_cnt][1]*100:.1f}%)"
        )

    out_path = (Path(__file__).resolve().parent / out_weights).resolve()
    export_weights_json(
        actor,
        partial_val,
        god_critic,
        out_path,
        meta={
            "totalTrainedHands": num_updates * num_workers * per_worker_eps + warmstart_games,
            "updates": num_updates,
            "episodesPerUpdate": num_workers * per_worker_eps,
            "warmstartGames": warmstart_games,
            "evalByPlayerCount": {
                str(np_cnt): {
                    "vsHeuristicEv": round(final_h[np_cnt][0], 4),
                    "vsHeuristicWinRate": round(final_h[np_cnt][1], 4),
                    "vsMcTeacherEv": round(final_t[np_cnt][0], 4),
                    "vsMcTeacherWinRate": round(final_t[np_cnt][1], 4),
                }
                for np_cnt in [2, 3, 4, 5]
            },
            "trainedAt": int(time.time()),
        },
    )


if __name__ == "__main__":
    train()
