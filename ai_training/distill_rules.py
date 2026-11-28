"""
方案 B: 分人数分层次规则蒸馏脚本 (Stratified Rule Distillation)
读取 20万局训练出的 ai_weights.json，在 2人 / 3人 / 4人 / 5人 对局中分别运行共 40,000 局自博弈，
统计【活跃对手数 x 牌型等级 x 宝牌数 x 巡目】下的胜率、期望得分、动作倾向与跑路/开牌阈值，
生成分层表 (`opp_rank_dora_orbit`) 与全局回退表 (`rank_dora_orbit`) 写入 ai_weights.json。
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
    encode_actor_obs,
    find_best_hand,
    ACT_CALL_SHOWDOWN,
    ACT_FOLD,
    ACT_EXPAND_BOARD,
    ACT_DISCARD1_OFFSET,
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
    return min(orbit, 4)


def bucket_dora(dora: int) -> int:
    return min(dora, 3)


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


def _make_bucket():
    return {
        "count": 0,
        "sumReturn": 0.0,
        "wins": 0,
        "SHOWDOWN": 0,
        "FOLD": 0,
        "EXPAND": 0,
        "DISCARD": 0,
        "SWAP": 0,
        "BANISH": 0,
    }


@torch.no_grad()
def distill(
    weights_rel_path: str = "../server/src/engine/ai_weights.json",
    num_games: int = 40000,
) -> None:
    weights_path = (Path(__file__).resolve().parent / weights_rel_path).resolve()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    actor = load_actor_from_json(weights_path, device)

    rng = random.Random(20261128)
    stratified_stats = defaultdict(_make_bucket)  # oppBucket_rank_dora_orbit
    global_stats = defaultdict(_make_bucket)      # rank_dora_orbit (fallback)

    batch_envs = 256
    batches = max(1, num_games // batch_envs)

    for b_idx in range(batches):
        envs = [
            DoraHoldemSim(player_count=[2, 3, 4, 5][i % 4], seed=b_idx * 1000 + i)
            for i in range(batch_envs)
        ]
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
                probs = torch.softmax(logits / 0.75, dim=-1)
                acts = torch.multinomial(probs, num_samples=1).squeeze(-1).cpu().tolist()

                for (idx, seat), act in zip(meta, acts):
                    sim = envs[idx]
                    p = sim.players[seat]
                    ev = find_best_hand(p.hole_cards, sim.community_cards, sim.legal_dora_idx)
                    active_opps = max(1, sum(1 for pl in sim.players.values() if not pl.is_folded and pl.seat != seat))
                    d_b = bucket_dora(ev[2])
                    o_b = bucket_orbit(sim.current_orbit)
                    s_key = f"{active_opps}_{ev[0]}_{d_b}_{o_b}"
                    g_key = f"{ev[0]}_{d_b}_{o_b}"
                    records[idx].append((seat, s_key, g_key, action_family(act)))
                    sim.step(act)
                    steps[idx] += 1

            next_active = []
            for idx in active:
                sim = envs[idx]
                if sim.is_finished:
                    for seat, s_key, g_key, fam in records[idx]:
                        delta = sim.last_score_changes.get(seat, 0)
                        for tbl, key in ((stratified_stats, s_key), (global_stats, g_key)):
                            st = tbl[key]
                            st["count"] += 1
                            st["sumReturn"] += delta
                            if delta > 0:
                                st["wins"] += 1
                            st[fam] += 1
                else:
                    next_active.append(idx)
            active = next_active

    def serialize_table(tbl: Dict) -> Dict[str, Dict]:
        out: Dict[str, Dict] = {}
        for key, st in sorted(tbl.items()):
            c = max(1, st["count"])
            out[key] = {
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
        return out

    stratified_table = serialize_table(stratified_stats)
    global_table = serialize_table(global_stats)
    merged_table = {**global_table, **stratified_table}

    with open(weights_path, "r", encoding="utf-8") as f:
        full_weights = json.load(f)

    full_weights["distilledRules"] = {
        "gamesSimulated": batches * batch_envs,
        "stratifiedByActiveOpps": True,
        "stateTable": merged_table,
    }

    with open(weights_path, "w", encoding="utf-8") as f:
        json.dump(full_weights, f, separators=(",", ":"))

    print(
        f"[Distill] Completed {batches * batch_envs:,} hands (2P/3P/4P/5P equal); "
        f"wrote {len(stratified_table)} stratified + {len(global_table)} fallback buckets "
        f"({weights_path.stat().st_size / 1024:.1f} KB total)"
    )


if __name__ == "__main__":
    distill()
