"""
宿命公牌 (Dora Hold'em) - 非对称 Actor-Critic PPO (Asymmetric PPO) 自博弈训练脚本
流程:
1. 专家热启动 (Behavior Cloning): 用强启发式+EV采样先预热 Actor 与双 Critic，跳过盲目随机探索期；
2. 非对称 PPO 自博弈 (Asymmetric Self-Play):
   - Actor (PolicyNet) & PartialValueNet: 仅使用正常玩家视角特征 (331 维)
   - Critic (GodCriticNet): 开启“上帝视角”(571 维)，能看到所有对手暗牌与真实终局牌型，
     精准估算 GAE 优势并指导 Actor 学会在信息残缺下换牌、欺诈、止损与抓开牌；
   - 训练中混合 1 步前瞻引导与历史对手快照池，防止策略坍缩。
3. 导出方案 A 权重 ai_weights.json (Actor + PartialValueNet + GodCriticNet)。
"""

from __future__ import annotations

import copy
import json
import random
import time
from pathlib import Path
from typing import Dict, List, Tuple

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
    """带 30 次蒙特卡洛胜率推演 + 数学 EV 的强教师策略（用于热启动和混合对手）"""
    mask = sim.get_legal_action_mask(seat)
    p = sim.players[seat]
    hole = sim.get_sorted_hole(seat)
    board = sim.get_sorted_board()
    exposed_set = set(p.exposed_cards)
    my_eval = find_best_hand(hole, board, sim.legal_dora_idx)

    # 计算公开死牌
    dead = set(hole) | set(board)
    for pl in sim.players.values():
        dead.update(pl.exposed_cards)
        dead.update(pl.face_up_discards)
    unseen = [c for c in ALL_CARDS if c not in dead]
    active_opps = sum(1 for pl in sim.players.values() if not pl.is_folded and pl.seat != seat)

    wins = 0.0
    sims = 24
    if active_opps > 0 and len(unseen) >= active_opps * 5:
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

    if win_rate >= 0.72 or (showdown_ev > 3.5 and sim.current_orbit >= 2):
        return ACT_CALL_SHOWDOWN

    if win_rate < 0.28 and sim.current_orbit >= 2 and fold_ev > showdown_ev - 0.5:
        return ACT_FOLD

    # 寻找能显著提高成牌等级或宝牌数的最佳 Swap
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
            t_eval = find_best_hand(t_hole, t_board, sim.legal_dora_idx)
            cmp = compare_eval(t_eval, my_eval)
            if cmp > 0 or (cmp == 0 and t_eval[2] > my_eval[2]):
                score = t_eval[0] * 100 + t_eval[2] * 20 + (t_eval[1][0] if t_eval[1] else 0)
                if best_swap is None or score > best_swap[0]:
                    best_swap = (score, act_id)
    if best_swap is not None and (rng.random() < 0.85 or sim.current_orbit >= 2):
        return best_swap[1]

    if len(board) < 4 and len(sim.draw_pile) >= 2 and (my_eval[0] >= 2 or win_rate < 0.55) and rng.random() < 0.38:
        if mask[ACT_EXPAND_BOARD]:
            return ACT_EXPAND_BOARD

    if len(board) >= 2 and len(sim.draw_pile) >= 2 and rng.random() < 0.16:
        best_set = set(my_eval[3])
        for b_idx, b_c in enumerate(board[:MAX_BOARD_SLOTS]):
            if CARD_RANK_IDX[b_c] != sim.legal_dora_idx and b_c not in best_set:
                act_id = ACT_BANISH_OFFSET + b_idx
                if mask[act_id]:
                    return act_id

    best_set = set(my_eval[3])
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
    """擅长扩充公牌、置换和止损的多巡目对手，防止自博弈早衰"""
    mask = sim.get_legal_action_mask(seat)
    p = sim.players[seat]
    hole = sim.get_sorted_hole(seat)
    board = sim.get_sorted_board()
    my_eval = find_best_hand(hole, board, sim.legal_dora_idx)
    if sim.current_orbit >= 3 and my_eval[0] <= 2 and my_eval[2] == 0 and rng.random() < 0.65:
        return ACT_FOLD
    if len(board) < 4 and mask[ACT_EXPAND_BOARD] and rng.random() < 0.55:
        return ACT_EXPAND_BOARD
    return strong_teacher_action(sim, seat, rng)


@torch.no_grad()
def select_action_batch(
    actor: ActorPolicyNet,
    obs_list: List[List[float]],
    mask_list: List[List[int]],
    device: torch.device,
    temperature: float = 1.0,
) -> Tuple[List[int], List[float]]:
    obs_t = torch.tensor(obs_list, dtype=torch.float32, device=device)
    mask_t = torch.tensor(mask_list, dtype=torch.float32, device=device)
    logits = actor(obs_t) / max(temperature, 1e-4)
    dist = masked_categorical(logits, mask_t)
    actions = dist.sample()
    log_probs = dist.log_prob(actions)
    return actions.cpu().tolist(), log_probs.cpu().tolist()


@torch.no_grad()
def evaluate_vs_opponent(
    actor: ActorPolicyNet,
    device: torch.device,
    opponent_fn,
    num_games: int = 300,
    seed: int = 12345,
) -> Tuple[float, float]:
    rng = random.Random(seed)
    actor.eval()
    total_score = 0.0
    wins = 0
    for g in range(num_games):
        n_p = [2, 3, 4][g % 3]
        ai_seat = (g % n_p) + 1
        sim = DoraHoldemSim(player_count=n_p, seed=seed + g)
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
    actor.train()
    return total_score / num_games, wins / num_games


def warmstart_bc(
    actor: ActorPolicyNet,
    partial_val: ValueMLP,
    god_critic: ValueMLP,
    device: torch.device,
    num_games: int = 1600,
    epochs: int = 8,
    batch_size: int = 512,
) -> None:
    """使用强教师自博弈样本预热 Actor 与双 Critic，加快 PPO 收敛并稳定策略分布"""
    print(f"[Warmstart] Generating {num_games} teacher self-play hands...")
    rng = random.Random(777)
    obs_a_all, obs_c_all, mask_all, act_all, ret_all = [], [], [], [], []

    for g in range(num_games):
        n_p = rng.choices([2, 3, 4, 5], weights=[0.25, 0.30, 0.30, 0.15], k=1)[0]
        sim = DoraHoldemSim(player_count=n_p, seed=50000 + g)
        ep_items = []
        steps = 0
        while not sim.is_finished and steps < 45:
            seat = sim.current_turn_seat
            obs_a = encode_actor_obs(sim, seat)
            obs_c = encode_critic_obs(sim, seat)
            mask = sim.get_legal_action_mask(seat)
            # 60% 强教师，20% 扩牌/换牌构建型教师，20% 启发式混合增加局面覆盖度
            r_mode = rng.random()
            if r_mode < 0.60:
                act = strong_teacher_action(sim, seat, rng)
            elif r_mode < 0.82:
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

    oa_t = torch.tensor(obs_a_all, dtype=torch.float32, device=device)
    oc_t = torch.tensor(obs_c_all, dtype=torch.float32, device=device)
    m_t = torch.tensor(mask_all, dtype=torch.float32, device=device)
    a_t = torch.tensor(act_all, dtype=torch.long, device=device)
    r_t = torch.tensor(ret_all, dtype=torch.float32, device=device)

    opt_a = torch.optim.Adam(actor.parameters(), lr=8e-4)
    opt_p = torch.optim.Adam(partial_val.parameters(), lr=1e-3)
    opt_c = torch.optim.Adam(god_critic.parameters(), lr=1e-3)

    n = oa_t.shape[0]
    for ep in range(epochs):
        perm = torch.randperm(n, device=device)
        for start in range(0, n, batch_size):
            mb = perm[start:start + batch_size]
            logits = actor(oa_t[mb]).masked_fill(m_t[mb] <= 0.5, -1e9)
            ce = F.cross_entropy(logits, a_t[mb], label_smoothing=0.10)
            opt_a.zero_grad()
            ce.backward()
            opt_a.step()

            vp = partial_val(oa_t[mb])
            lp = F.smooth_l1_loss(vp, r_t[mb])
            opt_p.zero_grad()
            lp.backward()
            opt_p.step()

            vc = god_critic(oc_t[mb])
            lc = F.smooth_l1_loss(vc, r_t[mb])
            opt_c.zero_grad()
            lc.backward()
            opt_c.step()

    ev_h, wr_h = evaluate_vs_opponent(actor, device, heuristic_bot_action, num_games=240, seed=1111)
    print(f"[Warmstart] Done ({n} transitions). vs_heuristic EV={ev_h:+.3f} pts/hand win_rate={wr_h*100:.1f}%")


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
        "version": 1,
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


def train(
    num_updates: int = 160,
    episodes_per_update: int = 128,
    ppo_epochs: int = 4,
    batch_size: int = 512,
    lr: float = 1.8e-4,
    warmstart_games: int = 2400,
    out_weights: str = "../server/src/engine/ai_weights.json",
):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[Train] Using device: {device}, updates={num_updates}, episodes/update={episodes_per_update}")

    actor = ActorPolicyNet().to(device)
    partial_val = ValueMLP(OBS_ACTOR_DIM, 128, 64).to(device)
    god_critic = ValueMLP(OBS_CRITIC_DIM, 128, 64).to(device)

    t0 = time.time()
    if warmstart_games > 0:
        warmstart_bc(actor, partial_val, god_critic, device, num_games=warmstart_games)

    actor_opt = torch.optim.Adam(actor.parameters(), lr=lr)
    pval_opt = torch.optim.Adam(partial_val.parameters(), lr=lr * 1.5)
    critic_opt = torch.optim.Adam(god_critic.parameters(), lr=lr * 1.5)

    rng = random.Random(2026)
    opponent_pool: List[ActorPolicyNet] = [copy.deepcopy(actor).to(device)]
    opponent_pool[0].eval()

    best_score = -1e9
    best_state = (
        copy.deepcopy(actor.state_dict()),
        copy.deepcopy(partial_val.state_dict()),
        copy.deepcopy(god_critic.state_dict()),
    )

    for update in range(1, num_updates + 1):
        envs: List[DoraHoldemSim] = []
        seat_modes: List[Dict[int, Tuple[str, int]]] = []
        trajs: List[Dict[int, Dict[str, list]]] = []

        for e in range(episodes_per_update):
            n_p = rng.choices([2, 3, 4, 5], weights=[0.22, 0.30, 0.33, 0.15], k=1)[0]
            sim = DoraHoldemSim(player_count=n_p, seed=update * 10000 + e)
            envs.append(sim)

            modes: Dict[int, Tuple[str, int]] = {}
            train_seat = rng.randint(1, n_p)
            for s in range(1, n_p + 1):
                if s == train_seat:
                    modes[s] = ("self", -1)
                else:
                    r = rng.random()
                    if r < 0.50:
                        modes[s] = ("self", -1)
                    elif r < 0.72:
                        modes[s] = ("pool", rng.randrange(len(opponent_pool)))
                    elif r < 0.85:
                        modes[s] = ("teacher", -1)
                    elif r < 0.93:
                        modes[s] = ("builder", -1)
                    else:
                        modes[s] = ("heur", -1)
            seat_modes.append(modes)
            trajs.append({
                s: {
                    "obs_a": [],
                    "obs_c": [],
                    "mask": [],
                    "act": [],
                    "logp": [],
                    "v_god": [],
                    "rew": [],
                    "done": [],
                }
                for s in range(1, n_p + 1)
                if modes[s][0] == "self"
            })

        active_indices = list(range(episodes_per_update))
        step_counts = [0] * episodes_per_update
        actor.eval()
        god_critic.eval()

        while active_indices:
            self_batch_meta = []
            self_obs_a = []
            self_obs_c = []
            self_masks = []
            pool_batches: Dict[int, list] = {}
            script_actions: List[Tuple[int, int]] = []

            for idx in active_indices:
                sim = envs[idx]
                seat = sim.current_turn_seat
                if step_counts[idx] >= 45:
                    script_actions.append((idx, ACT_CALL_SHOWDOWN))
                    continue

                mode, pool_idx = seat_modes[idx][seat]
                if mode == "heur":
                    script_actions.append((idx, heuristic_bot_action(sim, seat, rng)))
                elif mode == "teacher":
                    script_actions.append((idx, strong_teacher_action(sim, seat, rng)))
                elif mode == "builder":
                    script_actions.append((idx, builder_bot_action(sim, seat, rng)))
                elif mode == "self":
                    obs_a = encode_actor_obs(sim, seat)
                    obs_c = encode_critic_obs(sim, seat)
                    mask = sim.get_legal_action_mask(seat)
                    self_batch_meta.append((idx, seat))
                    self_obs_a.append(obs_a)
                    self_obs_c.append(obs_c)
                    self_masks.append(mask)
                else:
                    obs_a = encode_actor_obs(sim, seat)
                    mask = sim.get_legal_action_mask(seat)
                    pool_batches.setdefault(pool_idx, []).append((idx, obs_a, mask))

            for idx, act in script_actions:
                envs[idx].step(act)
                step_counts[idx] += 1

            for p_idx, items in pool_batches.items():
                p_net = opponent_pool[p_idx]
                p_obs = [it[1] for it in items]
                p_masks = [it[2] for it in items]
                acts, _ = select_action_batch(p_net, p_obs, p_masks, device, temperature=0.8)
                for (idx, _, _), act in zip(items, acts):
                    envs[idx].step(act)
                    step_counts[idx] += 1

            if self_batch_meta:
                obs_a_t = torch.tensor(self_obs_a, dtype=torch.float32, device=device)
                obs_c_t = torch.tensor(self_obs_c, dtype=torch.float32, device=device)
                mask_t = torch.tensor(self_masks, dtype=torch.float32, device=device)
                with torch.no_grad():
                    logits = actor(obs_a_t) / 1.12
                    dist = masked_categorical(logits, mask_t)
                    acts_t = dist.sample()
                    logps_t = dist.log_prob(acts_t)
                    v_god_t = god_critic(obs_c_t)

                acts_list = acts_t.cpu().tolist()
                logps_list = logps_t.cpu().tolist()
                vgod_list = v_god_t.cpu().tolist()

                for k, (idx, seat) in enumerate(self_batch_meta):
                    sim = envs[idx]
                    act = acts_list[k]
                    buf = trajs[idx][seat]
                    buf["obs_a"].append(self_obs_a[k])
                    buf["obs_c"].append(self_obs_c[k])
                    buf["mask"].append(self_masks[k])
                    buf["act"].append(act)
                    buf["logp"].append(logps_list[k])
                    buf["v_god"].append(vgod_list[k])

                    was_folded = sim.players[seat].is_folded
                    finished, _ = sim.step(act)
                    step_counts[idx] += 1
                    if sim.players[seat].is_folded and not was_folded and not finished:
                        buf["rew"].append(-sim.players[seat].fold_orbit / REWARD_SCALE)
                        buf["done"].append(True)
                    else:
                        buf["rew"].append(0.0)
                        buf["done"].append(False)

            next_active = []
            for idx in active_indices:
                sim = envs[idx]
                if sim.is_finished:
                    for seat, buf in trajs[idx].items():
                        if buf["done"] and not buf["done"][-1]:
                            buf["rew"][-1] = sim.last_score_changes[seat] / REWARD_SCALE
                            buf["done"][-1] = True
                else:
                    next_active.append(idx)
            active_indices = next_active

        all_obs_a, all_obs_c, all_masks, all_acts, all_old_logps, all_advs, all_rets = (
            [], [], [], [], [], [], []
        )
        for idx in range(episodes_per_update):
            for seat, buf in trajs[idx].items():
                if not buf["act"]:
                    continue
                adv, ret = compute_gae(buf["rew"], buf["v_god"], buf["done"])
                all_obs_a.extend(buf["obs_a"])
                all_obs_c.extend(buf["obs_c"])
                all_masks.extend(buf["mask"])
                all_acts.extend(buf["act"])
                all_old_logps.extend(buf["logp"])
                all_advs.extend(adv)
                all_rets.extend(ret)

        if len(all_acts) < 32:
            continue

        obs_a_arr = torch.tensor(all_obs_a, dtype=torch.float32, device=device)
        obs_c_arr = torch.tensor(all_obs_c, dtype=torch.float32, device=device)
        mask_arr = torch.tensor(all_masks, dtype=torch.float32, device=device)
        act_arr = torch.tensor(all_acts, dtype=torch.long, device=device)
        old_logp_arr = torch.tensor(all_old_logps, dtype=torch.float32, device=device)
        adv_arr = torch.tensor(all_advs, dtype=torch.float32, device=device)
        ret_arr = torch.tensor(all_rets, dtype=torch.float32, device=device)
        adv_norm = (adv_arr - adv_arr.mean()) / (adv_arr.std() + 1e-8)

        actor.train()
        partial_val.train()
        god_critic.train()

        n_samples = obs_a_arr.shape[0]
        ent_coef = max(0.015, 0.045 * (1.0 - update / num_updates))

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

                v_god_pred = god_critic(obs_c_arr[mb])
                critic_loss = F.smooth_l1_loss(v_god_pred, ret_arr[mb])
                critic_opt.zero_grad()
                critic_loss.backward()
                nn.utils.clip_grad_norm_(god_critic.parameters(), 0.5)
                critic_opt.step()

                v_part_pred = partial_val(obs_a_arr[mb])
                pval_loss = F.smooth_l1_loss(v_part_pred, ret_arr[mb])
                pval_opt.zero_grad()
                pval_loss.backward()
                nn.utils.clip_grad_norm_(partial_val.parameters(), 0.5)
                pval_opt.step()

        if update % 15 == 0:
            snap = copy.deepcopy(actor).to(device)
            snap.eval()
            opponent_pool.append(snap)
            if len(opponent_pool) > 10:
                opponent_pool.pop(0)

        if update == 1 or update % 20 == 0 or update == num_updates:
            ev_h, wr_h = evaluate_vs_opponent(actor, device, heuristic_bot_action, num_games=240, seed=9000 + update)
            ev_t, wr_t = evaluate_vs_opponent(actor, device, strong_teacher_action, num_games=240, seed=19000 + update)
            combined = 0.5 * ev_h + 0.5 * ev_t
            elapsed = time.time() - t0
            print(
                f"[Update {update:3d}/{num_updates}] samples={n_samples:4d} "
                f"vs_heur={ev_h:+.3f}({wr_h*100:.1f}%) "
                f"vs_mc_teacher={ev_t:+.3f}({wr_t*100:.1f}%) "
                f"elapsed={elapsed:.1f}s"
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

    final_ev_h, final_wr_h = evaluate_vs_opponent(actor, device, heuristic_bot_action, num_games=600, seed=77777)
    final_ev_t, final_wr_t = evaluate_vs_opponent(actor, device, strong_teacher_action, num_games=600, seed=88888)
    print(
        f"[Final Eval] 600 hands: vs_heur={final_ev_h:+.3f}({final_wr_h*100:.1f}%) | "
        f"vs_mc_teacher={final_ev_t:+.3f}({final_wr_t*100:.1f}%)"
    )

    out_path = (Path(__file__).resolve().parent / out_weights).resolve()
    export_weights_json(
        actor,
        partial_val,
        god_critic,
        out_path,
        meta={
            "updates": num_updates,
            "episodesPerUpdate": episodes_per_update,
            "warmstartGames": warmstart_games,
            "evalVsHeuristicEv": round(final_ev_h, 4),
            "evalVsHeuristicWinRate": round(final_wr_h, 4),
            "evalVsMcTeacherEv": round(final_ev_t, 4),
            "evalVsMcTeacherWinRate": round(final_wr_t, 4),
            "trainedAt": int(time.time()),
        },
    )


if __name__ == "__main__":
    train()
