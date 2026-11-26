"""
方案 B: 规则蒸馏脚本 (Rule Distillation)
读取 train_ppo.py 产出的神经网络权重 ai_weights.json，在本地运行大样本自博弈对局，
统计不同【牌型等级 x 宝牌数 x 巡目 x 公牌数】下的胜率、期望得分、最佳动作概率分布、
跑路阈值与开牌阈值，将其蒸馏为轻量静态规则表写入 ai_weights.json 中的 distilledRules 字段。
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

import torch

from dora_sim import (
    DoraHoldemSim,
    NUM_ACTIONS,
    OBS_ACTOR_DIM,
    encode_actor_obs,
    find_best_hand,
    ACT_CALL_SHOWDOWN,
    ACT_FOLD,
    ACT_EXPAND_BOARD,
    ACT_DISCARD1_OFFSET,
    ACT_DISCARD2_OFFSET,
    ACT_SWAP_OFFSET,
    ACT_BANISH_OFFSET,
)
from train_ppo import ActorPolicyNet


def load_actor_from_json(weights_path: Path, device: torch.device) -> ActorPolicyNet:
    with open(weights_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    actor = ActorPolicyNet(obs_dim=data["obsActorDim"], num_actions=data["numActions"]).to(device)
    layers = [actor.fc1, actor.fc2, actor.logits]
    for layer, ldata in zip(layers, data["actorLayers"]):
        w = torch.tensor(ldata["w"], dtype=torch.float32).view(ldata["out"], ldata["in"])
        b = torch.tensor(ldata["b"], dtype=torch.float32)
        with torch.no_grad():
            layer.weight.copy_(w)
            layer.bias.copy_(b)
    actor.eval()
    return actor


def bucket_orbit(orbit: int) -> int:
    return min(orbit, 4)  # 1, 2, 3, 4+


def bucket_dora(dora: int) -> int:
    return min(dora, 3)  # 0, 1, 2, 3+


def action_family(act_id: int) -> str:
    if act_id == ACT_CALL_SHOWDOWN:
        return "SHOWDOWN"
    if act_id == ACT_FOLD:
        return "FOLD"
    if act_id == ACT_EXPAND_BOARD:
        return "EXPAND"
    if ACT_DISCARD1_OFFSET <= act_id < ACT_SWAP_OFFSET:
        return "DISCARD"
    if ACT_SWAP_OFFSET <= act_id < ACT_BANISH_OFFSET:
        return "SWAP"
    return "BANISH"


@torch.no_grad()
def distill(
    weights_rel_path: str = "../server/src/engine/ai_weights.json",
    num_games: int = 16000,
) -> None:
    weights_path = (Path(__file__).resolve().parent / weights_rel_path).resolve()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    actor = load_actor_from_json(weights_path, device)

    rng = random.Random(202611)
    # key = f"{rank}_{dora_b}_{orbit_b}"
    stats = defaultdict(lambda: {
        "count": 0,
        "sumReturn": 0.0,
        "wins": 0,
        "SHOWDOWN": 0,
        "FOLD": 0,
        "EXPAND": 0,
        "DISCARD": 0,
        "SWAP": 0,
        "BANISH": 0,
    })

    # 批量并行跑环境提升速度
    batch_envs = 128
    batches = max(1, num_games // batch_envs)

    for b_idx in range(batches):
        envs = [
            DoraHoldemSim(player_count=rng.choice([2, 3, 4, 5]), seed=b_idx * 1000 + i)
            for i in range(batch_envs)
        ]
        # 记录每局每个决策点 (seat, key, family)
        records: List[List[tuple]] = [[] for _ in range(batch_envs)]
        steps = [0] * batch_envs
        active = list(range(batch_envs))

        while active:
            obs_batch = []
            mask_batch = []
            meta = []
            for idx in active:
                sim = envs[idx]
                seat = sim.current_turn_seat
                if steps[idx] >= 45:
                    sim.step(ACT_CALL_SHOWDOWN)
                    continue
                obs_batch.append(encode_actor_obs(sim, seat))
                mask_batch.append(sim.get_legal_action_mask(seat))
                meta.append((idx, seat))

            if obs_batch:
                obs_t = torch.tensor(obs_batch, dtype=torch.float32, device=device)
                mask_t = torch.tensor(mask_batch, dtype=torch.float32, device=device)
                logits = actor(obs_t).masked_fill(mask_t <= 0.5, -1e9)
                probs = torch.softmax(logits / 0.7, dim=-1)
                acts = torch.multinomial(probs, num_samples=1).squeeze(-1).cpu().tolist()

                for (idx, seat), act in zip(meta, acts):
                    sim = envs[idx]
                    p = sim.players[seat]
                    ev = find_best_hand(p.hole_cards, sim.community_cards, sim.legal_dora_idx)
                    key = f"{ev[0]}_{bucket_dora(ev[2])}_{bucket_orbit(sim.current_orbit)}"
                    records[idx].append((seat, key, action_family(act)))
                    sim.step(act)
                    steps[idx] += 1

            next_active = []
            for idx in active:
                sim = envs[idx]
                if sim.is_finished:
                    for seat, key, fam in records[idx]:
                        delta = sim.last_score_changes.get(seat, 0)
                        st = stats[key]
                        st["count"] += 1
                        st["sumReturn"] += delta
                        if delta > 0:
                            st["wins"] += 1
                        st[fam] += 1
                else:
                    next_active.append(idx)
            active = next_active

    distilled_table: Dict[str, Dict] = {}
    for key, st in sorted(stats.items()):
        c = max(1, st["count"])
        distilled_table[key] = {
            "count": st["count"],
            "avgReturn": round(st["sumReturn"] / c, 3),
            "winRate": round(st["wins"] / c, 4),
            "actionProbs": {
                "SHOWDOWN": round(st["SHOWDOWN"] / c, 4),
                "FOLD": round(st["FOLD"] / c, 4),
                "EXPAND": round(st["EXPAND"] / c, 4),
                "DISCARD": round(st["DISCARD"] / c, 4),
                "SWAP": round(st["SWAP"] / c, 4),
                "BANISH": round(st["BANISH"] / c, 4),
            },
        }

    # 按巡目 x 牌型提炼跑路阈值与开牌阈值摘要
    fold_thresholds: Dict[str, float] = {}
    showdown_thresholds: Dict[str, float] = {}
    for key, entry in distilled_table.items():
        fold_thresholds[key] = entry["actionProbs"]["FOLD"]
        showdown_thresholds[key] = entry["actionProbs"]["SHOWDOWN"]

    with open(weights_path, "r", encoding="utf-8") as f:
        full_weights = json.load(f)

    full_weights["distilledRules"] = {
        "gamesSimulated": batches * batch_envs,
        "stateTable": distilled_table,
    }

    with open(weights_path, "w", encoding="utf-8") as f:
        json.dump(full_weights, f, separators=(",", ":"))

    print(
        f"[Distill] Completed {batches * batch_envs} self-play hands; "
        f"wrote {len(distilled_table)} distilled buckets to {weights_path} "
        f"({weights_path.stat().st_size / 1024:.1f} KB total)"
    )


if __name__ == "__main__":
    distill()
