# 《宿命公牌》（Dora Hold'em）多人实时线上对战平台

[![Website](https://img.shields.io/badge/Live%20Demo-dhold.panaolin.com-amber.svg)](https://dhold.panaolin.com)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%2B-blue.svg)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3.5%2B-emerald.svg)](https://vuejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4%2B-sky.svg)](https://tailwindcss.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0%2B-orange.svg)](https://www.mysql.com/)
[![License](https://img.shields.io/badge/License-ISC-purple.svg)]()

> **线上体验地址**：🌐 [https://dhold.panaolin.com](https://dhold.panaolin.com)  
> **快速跳转 / Quick Navigation**：[English Version / 跳转至英文简介](#dora-holdem-multiplayer-online-battle-platform) 

---

## 中文介绍

《宿命公牌》（*Dora Hold'em*）是一款融合了**德州扑克**成牌大小判定与**宝牌加分悬赏**的原创运营博弈扑克游戏。

本平台专为该游戏打造，是一套**原生轻量、高并发、低延迟、极低带宽消耗**的多人实时线上对战系统。系统支持 2~5 人同桌竞技，内置四级智能 AI 陪练（含 20 万局非对称 PPO 自博弈神经网络 + 规则蒸馏 + 限时 PIMC 1 步前瞻），全链路采用权威服务端防作弊、WebSocket 双端心跳与断线/刷新无损恢复架构，并提供中英双语与双主题沉浸式体验。

### 📜 游戏规则说明书

平台界面内已内嵌双语规则弹窗；如需研读完整的游戏规则、行动说明与官方判例，请直接参阅以下权威规则文档：
- 🇨🇳 **中文规则**：[《宿命公牌》正式规则说明书（规则.md）](./规则.md)
- 🇺🇸 **英文规则**：[Dora Hold'em Official Rulebook（rules.md）](./rules.md)

---

### 🌟 平台核心特色与设计亮点

#### 1. 完全无位图化卡牌（Zero Bitmap Cards）
- **全桌严禁使用任何卡牌位图图片（PNG/JPG/SVG）**；
- 所有扑克牌均由原生 HTML5 + Tailwind CSS + Unicode 花色字符（♠, ♥, ♣, ♦）渲染，背面采用纯 CSS 几何编织纹理；
- 前端生产环境 gzip 压缩后整体包体积仅 **~105 KB**（JS ~97.7 KB + CSS ~7.7 KB），即便是弱网或移动端设备均可实现毫秒级瞬间加载，将网络传输与流量消耗压榨至极限。

#### 2. 服务端绝对权威、零暗牌泄漏与断线重连保护（Authoritative Server & Resilience）
- 所有的洗牌（Fisher-Yates 算法）、发牌、宝牌锁定、摸牌堆扣除、巡目轮替与终局比牌均由后端权威状态机统一仲裁；
- **暗牌数据隔离**：终局决战（Showdown）开牌之前，后端**绝对不下发任何非本人的暗置手牌数据**；
- **双端心跳与刷新/暂离无损重连**：WebSocket 具备 `15s/25s` 双向心跳与页面切回活性检测；玩家意外刷新网页或短暂离开回来后，房间不解散且自动恢复所在桌位、手牌、脱敏行动记录及结算弹窗；同时支持任意玩家决定在**本小回合结束后**提前结束整场游戏；
- 弃牌换牌时（弃 2 张：1明1暗），全桌广播仅公开明置牌的面值，暗置牌仅广播数量，彻底封死客户端抓包作弊途径。

#### 3. 智能四级 AI 机器人与非对称 PPO 神经网络引擎（方案 A + 方案 B）
- **20 万局多进程非对称 PPO 自博弈训练（Asymmetric Actor-Critic PPO）**：在本地 PyTorch (CUDA) 环境下让行动网络（Actor，341 维玩家视角）与裁判网络（Critic，581 维上帝视角）进行 **206,400 局**跨 `2/3/4/5` 人均衡自博弈训练，随后运行 **39,936 局**分人数规则蒸馏，覆盖不同人数下的偷宝牌阻断、多人底池赔率、摸空猝死压力与跑路阈值差异；
- **零框架纯矩阵推理（方案 A）+ 分人数蒸馏规则表（方案 B）**：线上 Node.js 服务端完全脱离 Python/PyTorch，直接加载 ~2.5 MB 轻量权重 `ai_weights.json`，通过手写 `Float32Array` 矩阵乘加与 ReLU 推理：
  - **初级（Easy · 休闲）**：依托直觉与基础随机概率，适合新手快速熟悉流转；
  - **中级（Medium · 策略网络）**：0 搜索直接跑 **0.3ms 级**策略网络（Policy Net）并结合分人数蒸馏表温控采样，极低 CPU 占用且稳健合理；
  - **高级（Hard · 深度估值）**：策略网络 + 局部价值网络（Partial Value Net）+ 分人数蒸馏跑路/开牌阈值与宝牌/大牌阻断置换增强（平均 **< 0.5ms**）；
  - **终极（Ultimate · 宿命算圣）**：采用 **PIMC（行为加权完美信息蒙特卡洛平行世界采样）+ 1 步前瞻 + 上帝视角估值网络（God Critic Net）**，结合死牌追踪与对手行为一致性读牌，在 **12~16ms** 安全时间预算内精准推理最优决策；
- **2秒拟真人性化出牌节奏**：AI 思考与动作间隔固定为 2000ms，配合桌面最新战报横幅与实时行动日志，告别“突然闪过”的困惑，让对局节奏清晰易读。

#### 4. 全景牌谱回放与和牌复盘系统（Replay System）
- **50 场滚动清理 + 50 场永久收藏**：系统采用 FIFO 队列自动保留最近 50 场单小局记录，支持将精彩对局一键收藏（上限 50 场，不受滚动清理影响）；
- **底牌与和牌透视复盘**：复盘详情不仅支持单步前进/后退/自动播放，还提供**全桌底牌与最佳 5 张和牌（Best Hand）卡片**，清晰标明胜负归属、成牌牌型（如：四条、同花、葫芦）以及包含的宝牌加分。

#### 5. 基于相对庄家顺位的战绩系统（1~5 号位）
- 依据顺时针庄家轮替机制，动态换算每小局玩家相对于当轮庄家的真实顺位：
  $$\text{relativePosition} = ((pr.seat - \text{currentDealerSeat} + \text{maxPlayers}) \pmod{\text{maxPlayers}}) + 1$$
- 详细统计玩家在 **一号位（庄家）、二号位、三号位、四号位、五号位** 的总场次、胜率与胜局平均赢分；
- 对局进行中，允许点击任意玩家头像/姓名卡片，即时呼出战绩弹窗查阅对手实力。

#### 6. 中英双语与双主题无缝切换
- **双语（i18n）**：顶栏常驻无缝切换（zh-CN / en-US），界面文本、牌型命名与系统通知严格对齐规则文件；
- **双主题（Theme）**：支持**暗夜极光模式（Dark）**与**现代象牙白亮色模式（Light）**一键切换，绿色扑克毛毡桌台质感典雅。

---


<br id="dora-holdem-multiplayer-online-battle-platform">

## English Version

[![Website](https://img.shields.io/badge/Live%20Demo-dhold.panaolin.com-amber.svg)](https://dhold.panaolin.com)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%2B-blue.svg)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3.5%2B-emerald.svg)](https://vuejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4%2B-sky.svg)](https://tailwindcss.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0%2B-orange.svg)](https://www.mysql.com/)

> **Live Demo**: 🌐 [https://dhold.panaolin.com](https://dhold.panaolin.com)  
> **Navigation**: [Back to Chinese / 返回中文介绍](#中文介绍) | [Technical Details & Deployment (build.md)](./build.md)

---

### Overview

*Dora Hold'em* (宿命公牌) is an original strategic card battle board game that seamlessly blends the **objective best 5-card mathematical evaluation of Texas Hold'em** with the **bonus point incentive of "Dora" tiles from Japanese Riichi Mahjong**.

This platform is a **lightweight, high-concurrency, low-latency, and ultra-low-bandwidth** multiplayer online gaming system specifically engineered for *Dora Hold'em*. It supports 2 to 5 players per table, features a 4-tier AI engine powered by **200,000+ hands of Asymmetric PPO self-play, player-count-stratified rule distillation, and time-bounded PIMC 1-step lookahead**, enforces an authoritative anti-cheat server with WebSocket heartbeat & seamless reconnect recovery, and provides native bilingual and dual-theme experiences.

---

### 📜 Official Rulebooks

A responsive in-game rulebook modal is readily accessible from the platform's navigation bar. To explore the complete game rules, turn actions, scoring formulas, and official rulings, please refer directly to the rule documents:
- 🇺🇸 **English Rulebook**: [Dora Hold'em Official Rulebook (rules.md)](./rules.md)
- 🇨🇳 **Chinese Rulebook**: [《宿命公牌》正式规则说明书（规则.md）](./规则.md)

---

### 🌟 Key Platform Features

#### 1. Zero Bitmap Cards
- **Strictly No Image Assets (PNG/JPG/SVG bitmaps)** used for playing cards;
- All cards are dynamically rendered using pure semantic HTML5, Tailwind CSS, Unicode suit characters (♠, ♥, ♣, ♦), and geometric woven CSS patterns for card backs;
- The entire production client gzip bundle size is **~105 KB** (JS ~97.7 KB + CSS ~7.7 KB), guaranteeing instantaneous page loads and minimal bandwidth consumption even under mobile or restricted networks.

#### 2. Authoritative Server, Anti-Cheat & Session Resilience
- All card shuffling (Fisher-Yates), dealing, Dora locking, draw pile deductions, orbit increments, and showdown settlements are authoritatively verified and executed by the backend engine;
- **Zero Hidden-Card Leakage**: Before the final showdown, hidden cards belonging to other players are **never transmitted** to the client;
- **Heartbeat, Refresh Recovery & Early Match End**: Dual-sided WebSocket heartbeats (`15s/25s`) and visibility recovery ensure accidental page refreshes or tab backgrounding seamlessly restore your exact seat, hole cards, sanitized action logs, and settlement modals without dissolving the room; any human player can also request to end the match cleanly once the current hand concludes;
- During Discard & Draw (2 cards: 1 face-up and 1 face-down), broadcasts announce only the identity of the face-up card and the count of the face-down card, preventing packet inspection exploits.

#### 3. 4-Tier Neural + PIMC AI Engine (Scheme A + Scheme B)
- **206,400-Hand Asymmetric PPO Self-Play & 39,936-Hand Stratified Rule Distillation**: Trained in PyTorch (CUDA) with a partial-observation Actor (`341` dims including explicit `2P/3P/4P/5P` player-count, active-opponent, deck-depletion urgency, and multiway pot-odds features) guided by a God-view Critic (`581` dims observing hidden hands), then distilled across 2–5 player tables into stratified win-rate and action priors;
- **Zero-Framework Pure Matrix Inference in Node.js**: Runs directly on ~2.5 MB JSON weights (`ai_weights.json`) using pure TypeScript `Float32Array` matrix multiplications and ReLU with zero Python runtime dependency:
  - **Easy (Casual)**: Heuristic intuition with playful variance for beginners;
  - **Medium (Policy Net)**: Zero-search `~0.3 ms` forward pass through the Actor Policy Net calibrated with player-count-stratified distilled priors;
  - **Hard (Distilled EV)**: Combines the Actor Policy Net, Partial Value Net, stratified fold/showdown thresholds, and Dora-steal/high-card-denial swap boosts (`< 0.5 ms`);
  - **Ultimate (PIMC + Neural Lookahead)**: Runs behavior-weighted **PIMC (Perfect Information Monte Carlo)** parallel worlds from the unseen deck + **1-step lookahead** scored by the God-view Value Net within a strict **12–16 ms** time budget;
- **Humanized 2s Turn Pacing**: AI actions are paced with a 2000ms delay, paired with a live action toast banner and scrolling table history log for maximum transparency.

#### 4. Replay System & Showdown Analysis
- **50-Hand FIFO Auto-Pruning + 50 Permanent Favorites**: Automatically maintains the latest 50 single hands with a FIFO queue while enabling up to 50 permanent favorites unaffected by pruning;
- **Full Showdown Transparency**: The replay viewer offers step-by-step or auto-play timeline playback as well as a comprehensive **Showdown & Hole Cards** card summary highlighting revealed hands, winning 5-card combinations, hand categories (e.g., Four of a Kind, Flush, Full House), and Dora bonus points.

#### 5. Relative Dealer Position Statistics (Positions 1 to 5)
- Dynamically calculates relative position with respect to the active round's dealer:
  $$\text{relativePosition} = ((pr.seat - \text{currentDealerSeat} + \text{maxPlayers}) \pmod{\text{maxPlayers}}) + 1$$
- Accurately tracks hands played, win rates, and average winning scores across **Position 1 (Dealer), Position 2, Position 3, Position 4, and Position 5**;
- In-game interaction allows clicking any player's avatar or nameplate to inspect their positional radar.

#### 6. Bilingual & Dual-Theme Experience
- **Bilingual (zh-CN / en-US)**: Instant language switcher with synchronized translations across all game actions, poker hand terminology, and rulebooks;
- **Dual-Theme (Dark / Light)**: Smooth toggle between Dark Mode and Ivory Light Mode, with rich poker felt textures and high-contrast typography.

---

