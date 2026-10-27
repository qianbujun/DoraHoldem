<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
    <div class="w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-3xl p-4 sm:p-6 shadow-2xl text-slate-100 flex flex-col gap-4 max-h-[92vh]">
      <!-- 弹窗顶栏 -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <span class="text-2xl">📼</span>
          <h3 class="text-base sm:text-lg font-bold text-amber-400">
            {{ activeHandReplay ? `${$t('replay.title')} - 第 ${activeHandReplay.round_number} 局` : $t('replay.title') }}
          </h3>
        </div>
        <button
          @click="onClose"
          class="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition"
        >
          ✕
        </button>
      </div>

      <!-- 视图 A: 牌谱列表视图 (最近50场 vs 收藏50场) -->
      <div v-if="!activeHandReplay" class="flex flex-col gap-3 flex-1 overflow-hidden">
        <!-- 标签页切换 -->
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2 text-xs sm:text-sm font-bold">
            <button
              @click="tab = 'recent'"
              class="px-4 py-1.5 rounded-xl transition"
              :class="tab === 'recent' ? 'bg-amber-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-400 hover:text-white'"
            >
              {{ $t('replay.recentHands') }}
            </button>
            <button
              @click="tab = 'favorites'"
              class="px-4 py-1.5 rounded-xl transition flex items-center gap-1.5"
              :class="tab === 'favorites' ? 'bg-amber-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-400 hover:text-white'"
            >
              <span>⭐</span>
              <span>{{ $t('replay.favoriteHands', { count: favoriteCount }) }}</span>
            </button>
          </div>
          <span class="text-xs text-slate-500 hidden sm:inline">
            上限50场滚动清理，收藏可永久保留
          </span>
        </div>

        <!-- 列表容器 -->
        <div class="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
          <div v-if="loadingList" class="py-12 text-center text-slate-500">
            加载牌谱中...
          </div>
          <div v-else-if="handsList.length === 0" class="py-12 text-center text-slate-500">
            {{ $t('replay.noRecords') }}
          </div>
          <div
            v-else
            v-for="hand in handsList"
            :key="hand.id"
            class="p-3 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-2xl flex items-center justify-between gap-3 transition"
          >
            <!-- 左侧：局数、宝牌、结果 -->
            <div class="flex items-center gap-3">
              <!-- 收藏星标按钮 -->
              <button
                @click.stop="toggleFavorite(hand)"
                class="text-lg p-1 hover:scale-125 transition"
                :title="hand.is_favorite ? $t('replay.unfavorite') : $t('replay.favorite')"
              >
                {{ hand.is_favorite ? '⭐' : '☆' }}
              </button>

              <div class="flex flex-col">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-sm text-slate-200">第 {{ hand.round_number }} 局</span>
                  <span class="text-xs text-amber-300/80 font-bold px-1.5 py-0.5 rounded bg-slate-700/60">
                    {{ getPositionName(hand.seat_position) }}
                  </span>
                  <span
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    :class="hand.is_winner ? 'bg-amber-400/20 text-amber-300' : (hand.is_folded ? 'bg-slate-700 text-slate-400' : 'bg-rose-500/20 text-rose-300')"
                  >
                    {{ hand.is_winner ? $t('roles.winner') : (hand.is_folded ? $t('roles.foldedPlayer') : $t('roles.activeLoser')) }}
                  </span>
                </div>
                <div class="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                  <span>宝牌: <b class="text-amber-400">{{ hand.dora_rank }}</b></span>
                  <span>|</span>
                  <span>巡目: {{ hand.final_orbit }}</span>
                  <span>|</span>
                  <span>底分: {{ hand.base_score }}</span>
                  <span>|</span>
                  <span class="text-slate-500">{{ formatDate(hand.created_at) }}</span>
                </div>
              </div>
            </div>

            <!-- 右侧：得分与回放按钮 -->
            <div class="flex items-center gap-4">
              <span
                class="font-black text-sm sm:text-base font-mono"
                :class="hand.net_score > 0 ? 'text-amber-400' : (hand.net_score < 0 ? 'text-rose-400' : 'text-slate-400')"
              >
                {{ hand.net_score > 0 ? '+' : '' }}{{ hand.net_score }}
              </span>
              <button
                @click="loadReplay(hand.hand_id)"
                class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow transition flex items-center gap-1.5"
              >
                <span>▶</span>
                <span>复盘</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 视图 B: 时序顺位复盘器 (顶栏写操作含暗牌揭秘，下置各家手牌，尾步开牌决胜比牌) -->
      <div v-else class="flex flex-col gap-3 flex-1 overflow-hidden">
        <!-- 局情概要条与控制栏 -->
        <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-800/80 p-3 rounded-2xl border border-slate-700/80 text-xs">
          <!-- 局情统计 -->
          <div class="flex flex-wrap items-center gap-2.5 font-medium text-slate-300">
            <span>第 <b class="text-amber-400">{{ activeHandReplay.round_number }}</b> 局</span>
            <span>|</span>
            <span>宝牌: <b class="text-amber-400">{{ activeHandReplay.dora_rank }}</b></span>
            <span>|</span>
            <span>巡目: <b>{{ isFinalStep ? activeHandReplay.final_orbit : (currentStep?.orbit || 1) }}</b></span>
            <span>|</span>
            <span>底分: <b class="text-amber-300">{{ activeHandReplay.base_score }}</b> pts</span>
            <span>|</span>
            <span class="text-slate-400">{{ $t('endReasons.' + activeHandReplay.end_reason) }}</span>
          </div>

          <!-- 单步调试与播放按钮群 -->
          <div class="flex items-center gap-1.5">
            <button
              :disabled="currentStepIndex <= 0"
              @click="currentStepIndex = 0"
              class="px-2.5 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-xs font-bold transition"
              title="回到首步"
            >
              ⏮
            </button>
            <button
              :disabled="currentStepIndex <= 0"
              @click="prevStep"
              class="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-xs font-bold transition"
            >
              ◀ {{ $t('replay.stepBackward') }}
            </button>
            <button
              @click="toggleAutoPlay"
              class="px-4 py-1.5 rounded-xl font-bold text-xs transition shadow flex items-center gap-1"
              :class="isPlaying ? 'bg-amber-500 text-slate-950' : 'bg-emerald-600 text-white'"
            >
              <span>{{ isPlaying ? '⏸ ' + $t('replay.pause') : '▶ ' + $t('replay.play') }}</span>
            </button>
            <button
              :disabled="currentStepIndex >= replayTotalSteps - 1"
              @click="nextStep"
              class="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-xs font-bold transition"
            >
              {{ $t('replay.stepForward') }} ▶
            </button>
            <button
              @click="currentStepIndex = replayTotalSteps - 1"
              class="px-3 py-1.5 rounded-xl font-bold text-xs transition shadow flex items-center gap-1"
              :class="isFinalStep ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-amber-300 hover:bg-slate-600'"
              title="跳转至终局决胜和牌比较"
            >
              <span>🏆 终局比牌</span>
            </button>
            <button
              @click="exitReplay"
              class="ml-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
            >
              {{ $t('replay.exit') }}
            </button>
          </div>
        </div>

        <!-- 步骤指示条 -->
        <div class="flex items-center justify-between px-1 text-xs">
          <div class="flex items-center gap-2">
            <span v-if="!isFinalStep" class="font-bold text-amber-400">
              步骤 #{{ currentStepIndex + 1 }} / {{ replayTotalSteps }}
            </span>
            <span v-else class="font-bold text-amber-400 flex items-center gap-1">
              <span>🏆</span>
              <span>步骤 #{{ replayTotalSteps }} / {{ replayTotalSteps }} · 终局决战和牌比牌</span>
            </span>
            <span class="text-slate-500">|</span>
            <span class="text-slate-400">
              {{ isFinalStep ? '全桌开牌决胜，比较和牌与利用公牌' : currentStepDescription }}
            </span>
          </div>
          <span class="text-slate-500 hidden sm:inline">
            可点击下方行动列表任意步跳转
          </span>
        </div>

        <!-- 主内容滚动区 (根据是否为最后一步切换：对局行动步 vs 终局比牌) -->
        <div class="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          <!-- ================= 模式 1：常规行动步 (当前处于对局流中) ================= -->
          <template v-if="!isFinalStep && currentStep">
            <!-- 1. 最上面写该玩家操作（弃置牌中的暗牌也要标明） -->
            <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-inner">
              <!-- 行动者与动作标题 -->
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div class="flex items-center gap-2.5">
                  <span class="w-7 h-7 rounded-full bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shadow">
                    #{{ currentStep.seat }}
                  </span>
                  <div class="flex items-center gap-1.5">
                    <span class="font-bold text-sm text-slate-100">{{ currentStep.username }}</span>
                    <span class="text-xs text-slate-400">({{ getPositionName(currentStep.seat) }})</span>
                  </div>
                  <span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {{ getActionTitle(currentStep.action) }}
                  </span>
                </div>
                <div class="text-xs text-slate-400 font-mono">
                  第 {{ currentStep.orbit }} 巡
                </div>
              </div>

              <!-- 行动卡牌可视化说明 (弃牌中的暗牌在此完全揭晓并标明) -->
              <div class="flex flex-wrap items-center gap-3 text-xs text-slate-300 pt-1">
                <!-- 动作 1: DISCARD_DRAW (弃牌换牌) -->
                <template v-if="currentStep.action === 'DISCARD_DRAW'">
                  <!-- 明弃牌 -->
                  <div v-if="currentStep.details.discardFaceUp" class="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span class="text-slate-400 font-semibold">明弃牌:</span>
                    <Card
                      :card="currentStep.details.discardFaceUp"
                      :isDora="isDora(currentStep.details.discardFaceUp)"
                      size="sm"
                    />
                  </div>

                  <!-- 暗弃牌 (暗牌在此揭晓并打上专属揭秘徽章) -->
                  <div v-if="currentStep.details.discardFaceDown" class="flex items-center gap-2 bg-indigo-950/40 px-3 py-1.5 rounded-xl border border-indigo-500/50">
                    <div class="flex flex-col">
                      <span class="text-indigo-300 font-black">暗弃牌:</span>
                      <span class="text-[9px] text-amber-400 font-mono">已揭示暗牌</span>
                    </div>
                    <Card
                      :card="currentStep.details.discardFaceDown"
                      :isDora="isDora(currentStep.details.discardFaceDown)"
                      size="sm"
                    />
                  </div>
                  <div v-else-if="currentStep.details.discardFaceDownCount" class="flex items-center gap-1.5 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800 text-slate-400">
                    <span>暗弃牌:</span>
                    <span class="font-bold text-slate-200">1 张 (历史未记录暗牌点数)</span>
                  </div>

                  <!-- 摸牌数 -->
                  <div class="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span class="text-slate-400 font-semibold">摸牌:</span>
                    <span class="font-black text-amber-400 font-mono text-sm">+{{ currentStep.details.drawCount }} 张</span>
                    <!-- 若记录了新摸出的底牌 -->
                    <div v-if="currentStep.details.drawnCards?.length" class="flex items-center gap-1 ml-1">
                      <Card
                        v-for="dCard in currentStep.details.drawnCards"
                        :key="dCard"
                        :card="dCard"
                        :isDora="isDora(dCard)"
                        size="sm"
                      />
                    </div>
                  </div>
                </template>

                <!-- 动作 2A: SWAP (公私置换) -->
                <template v-else-if="currentStep.action === 'MANIPULATE_SWAP'">
                  <div class="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span class="text-slate-400 font-semibold">手牌换出:</span>
                    <Card
                      :card="currentStep.details.swappedHandCard"
                      :isDora="isDora(currentStep.details.swappedHandCard)"
                      size="sm"
                    />
                    <span class="text-amber-400 font-black text-base mx-1">⇄</span>
                    <span class="text-slate-400 font-semibold">公牌换入(明):</span>
                    <Card
                      :card="currentStep.details.swappedBoardCard"
                      :isDora="isDora(currentStep.details.swappedBoardCard)"
                      :isExposed="true"
                      size="sm"
                    />
                  </div>
                </template>

                <!-- 动作 2B: BANISH (放逐刷新) -->
                <template v-else-if="currentStep.action === 'MANIPULATE_BANISH'">
                  <div class="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span class="text-slate-400 font-semibold">放逐公牌:</span>
                    <Card
                      :card="currentStep.details.banishedCard"
                      :isDora="isDora(currentStep.details.banishedCard)"
                      size="sm"
                    />
                    <span class="text-amber-400 font-black text-base mx-1">➔</span>
                    <span class="text-slate-400 font-semibold">牌顶补入公区:</span>
                    <Card
                      :card="currentStep.details.refreshedCard"
                      :isDora="isDora(currentStep.details.refreshedCard)"
                      size="sm"
                    />
                  </div>
                </template>

                <!-- 动作 2C: EXPAND_BOARD (增加公牌) -->
                <template v-else-if="currentStep.action === 'EXPAND_BOARD'">
                  <div class="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span class="text-slate-400 font-semibold">牌顶翻开公牌:</span>
                    <Card
                      :card="currentStep.details.expandedCard"
                      :isDora="isDora(currentStep.details.expandedCard)"
                      size="sm"
                    />
                  </div>
                </template>

                <!-- 动作 3: FOLD (弃牌) -->
                <template v-else-if="currentStep.action === 'FOLD'">
                  <div class="flex items-center gap-2 bg-rose-950/40 border border-rose-500/40 px-3 py-1.5 rounded-xl text-rose-300">
                    <span>🏳️ 扣牌离场，向底池支付了</span>
                    <b class="text-rose-400 font-mono">{{ currentStep.details.foldCost }}</b>
                    <span>点筹码</span>
                  </div>
                </template>

                <!-- 动作 4: CALL_SHOWDOWN (决战) -->
                <template v-else-if="currentStep.action === 'CALL_SHOWDOWN'">
                  <div class="flex items-center gap-2 bg-amber-500/20 border border-amber-400/40 px-3 py-1.5 rounded-xl text-amber-300 font-bold">
                    <span>⚔️ 终结决战：主动发起全桌开牌决胜！</span>
                  </div>
                </template>
              </div>

              <!-- 当前步骤公共牌区 -->
              <div class="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
                <span class="text-xs text-slate-400 font-semibold">当前公共牌区 ({{ currentCommunityCards.length }} 张)：</span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <Card
                    v-for="(card, ci) in currentCommunityCards"
                    :key="'step_comm_' + card + '_' + ci"
                    :card="card"
                    :isDora="isDora(card)"
                    size="sm"
                  />
                </div>
              </div>
            </div>

            <!-- 2. 下边放各个玩家手牌（按顺位展示） -->
            <div class="flex flex-col gap-2.5">
              <div class="text-xs text-slate-400 font-bold px-1 flex items-center justify-between">
                <span>各玩家当前手牌状态（按顺位排列）：</span>
                <span class="text-[11px] text-slate-500 font-normal">标有「明」的手牌为操控公牌置换所得</span>
              </div>

              <div
                v-for="p in replayPlayers"
                :key="'step_player_' + p.seat"
                class="p-3 rounded-2xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                :class="[
                  p.seat === currentStep.seat ? 'bg-amber-500/10 border-amber-400/70 shadow-lg' : 'bg-slate-950/60 border-slate-800',
                  getPlayerHandAtStep(p.seat).isFolded ? 'opacity-50' : ''
                ]"
              >
                <!-- 玩家头栏 -->
                <div class="flex items-center gap-2.5 shrink-0">
                  <span
                    class="w-6 h-6 rounded-full flex items-center justify-center font-black text-xs"
                    :class="p.seat === 1 ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-700 text-slate-200'"
                  >
                    {{ p.seat === 1 ? $t('roles.dealerBadge') : p.seat }}
                  </span>
                  <span class="font-bold text-sm text-slate-100">
                    {{ p.username }}
                  </span>
                  <span class="text-xs text-slate-400">
                    ({{ getPositionName(p.seat) }})
                  </span>

                  <!-- 行动状态徽章 -->
                  <span
                    v-if="p.seat === currentStep.seat"
                    class="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow animate-pulse"
                  >
                    ⚡ 当前行动
                  </span>
                  <span
                    v-else-if="getPlayerHandAtStep(p.seat).isFolded"
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400"
                  >
                    🚫 已弃牌
                  </span>
                  <span
                    v-else
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300"
                  >
                    🟢 存活
                  </span>
                </div>

                <!-- 玩家手牌 (Hole Cards) -->
                <div class="flex items-center gap-1.5 overflow-x-auto py-1">
                  <div v-if="!getPlayerHandAtStep(p.seat).isFolded" class="flex items-center gap-1">
                    <Card
                      v-for="(card, ci) in getPlayerHandAtStep(p.seat).holeCards"
                      :key="'p_card_' + p.seat + '_' + card + '_' + ci"
                      :card="card"
                      :isDora="isDora(card)"
                      :isExposed="isCardExposed(getPlayerHandAtStep(p.seat), card)"
                      size="sm"
                    />
                  </div>
                  <div v-else class="text-xs text-slate-500 italic py-1">
                    （已扣牌离场）
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- ================= 模式 2：最后一步 (大家和牌型比较，标识胜利者) ================= -->
          <template v-else>
            <!-- 终局决战胜者横幅 -->
            <div class="bg-gradient-to-r from-amber-500/20 via-slate-900 to-amber-500/20 border border-amber-400/60 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xl">
              <div class="flex items-center gap-3">
                <span class="text-3xl">🏆</span>
                <div>
                  <div class="text-base sm:text-lg font-black text-amber-400 flex items-center gap-2">
                    <span>终局开牌比较 · 胜者决出！</span>
                  </div>
                  <div class="text-xs text-slate-300 mt-0.5">
                    {{ $t('endReasons.' + activeHandReplay.end_reason) }} · 
                    底分: <b class="text-amber-300 font-mono">{{ activeHandReplay.base_score }}</b> pts · 
                    巡目: {{ activeHandReplay.final_orbit }}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-slate-300 font-semibold">法定宝牌 (Dora):</span>
                <div class="px-2.5 py-1 rounded-xl bg-amber-400 text-slate-950 font-black text-sm shadow">
                  {{ activeHandReplay.dora_rank }}
                </div>
              </div>
            </div>

            <!-- 各玩家和牌与大小比较 (各家均展示手牌与右侧隔开的公共牌，用到的牌上移高亮) -->
            <div class="flex flex-col gap-3">
              <div class="text-xs text-slate-400 font-bold px-1 flex items-center justify-between">
                <span>各家和牌牌型与组成牌对比（按顺位排列）：</span>
                <span class="text-[11px] text-amber-400 font-normal">高亮上移的牌为组成最佳 5 张和牌的牌</span>
              </div>

              <div
                v-for="p in replayPlayers"
                :key="'showdown_' + p.seat"
                class="p-4 rounded-2xl border transition flex flex-col gap-3"
                :class="p.isWinner ? 'bg-amber-950/20 border-amber-400/80 ring-2 ring-amber-400/50 shadow-2xl' : 'bg-slate-950/60 border-slate-800'"
              >
                <!-- 玩家头栏 -->
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                  <div class="flex items-center gap-2.5">
                    <span
                      class="w-6 h-6 rounded-full flex items-center justify-center font-black text-xs"
                      :class="p.isWinner ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-700 text-slate-300'"
                    >
                      {{ p.seat === 1 ? $t('roles.dealerBadge') : p.seat }}
                    </span>
                    <span class="font-bold text-sm text-slate-100">{{ p.username }}</span>
                    <span class="text-xs text-slate-400">({{ getPositionName(p.seat) }})</span>

                    <!-- 胜利者 / 弃牌徽章 -->
                    <span
                      class="text-xs font-black px-2.5 py-0.5 rounded-full"
                      :class="p.isWinner ? 'bg-amber-400 text-slate-950 shadow font-black' : (p.isFolded ? 'bg-slate-800 text-slate-400' : 'bg-rose-500/20 text-rose-300')"
                    >
                      {{ p.isWinner ? '👑 ' + $t('roles.winner') : (p.isFolded ? $t('roles.foldedPlayer') : $t('roles.activeLoser')) }}
                    </span>

                    <!-- 和牌牌型 -->
                    <span v-if="p.bestHand" class="text-xs font-bold text-amber-300">
                      {{ $t(p.bestHand.rankNameKey) }}
                      <span v-if="p.doraCount > 0" class="text-amber-400 ml-1">
                        (+{{ p.doraCount }} 宝牌)
                      </span>
                    </span>
                  </div>

                  <!-- 积分变动 -->
                  <div class="font-mono font-black text-base sm:text-lg" :class="p.scoreChange > 0 ? 'text-amber-400' : (p.scoreChange < 0 ? 'text-rose-400' : 'text-slate-400')">
                    {{ p.scoreChange > 0 ? '+' : '' }}{{ p.scoreChange }} pts
                  </div>
                </div>

                <!-- 和牌利用手牌与公共牌对比区 (同手牌用到的牌处理，右侧隔开增加公共牌) -->
                <div v-if="!p.isFolded" class="flex flex-wrap items-center gap-3 pt-3 overflow-x-auto pb-1">
                  <!-- 左侧：玩家手牌 (Hole Cards) -->
                  <div class="flex flex-col gap-1 shrink-0">
                    <span class="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                      <span>🎴</span>
                      <span>{{ $t('replay.holeCards') || '底牌手牌' }} (5张)</span>
                    </span>
                    <div class="flex items-center gap-1">
                      <Card
                        v-for="(card, ci) in p.holeCards"
                        :key="'sh_hole_' + p.seat + '_' + card + '_' + ci"
                        :card="card"
                        :isDora="isDora(card)"
                        :isExposed="isCardExposed(p, card)"
                        :selected="isCardInBestHand(card, p.bestHand)"
                        size="sm"
                      />
                    </div>
                  </div>

                  <!-- 居中加号与分割线 -->
                  <div class="flex flex-col items-center justify-center px-1.5 text-slate-500 font-black self-center shrink-0">
                    <span class="text-base leading-none text-amber-400/80">+</span>
                    <span class="text-[9px] text-slate-400 tracking-wider">公牌</span>
                  </div>

                  <!-- 右侧：终局公共牌 (Community Cards)，该玩家用到的公牌同样上移高亮 -->
                  <div class="flex flex-col gap-1 shrink-0">
                    <span class="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                      <span>🏛️</span>
                      <span>{{ $t('game.communityCards') || '公共牌区' }} ({{ activeHandReplay.final_community_cards?.length || 0 }}张)</span>
                    </span>
                    <div class="flex items-center gap-1">
                      <Card
                        v-for="(cCard, cci) in activeHandReplay.final_community_cards"
                        :key="'sh_comm_' + p.seat + '_' + cCard + '_' + cci"
                        :card="cCard"
                        :isDora="isDora(cCard)"
                        :selected="isCardInBestHand(cCard, p.bestHand)"
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
                <div v-else class="text-xs text-slate-500 italic py-1">
                  （扣牌离场，未参与比牌）
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 底部单步日志抽屉/跳转流 (点击可直接跳至指定行动步) -->
        <div class="border-t border-slate-800 pt-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400 px-1">
            <span class="font-bold text-slate-300">行动历史时间轴 (点击跳转)：</span>
            <span>共 {{ activeHandReplay.action_history?.length || 0 }} 个行动步骤</span>
          </div>

          <div class="flex items-center gap-1.5 overflow-x-auto py-1 text-xs">
            <button
              v-for="(log, idx) in activeHandReplay.action_history"
              :key="'nav_' + idx"
              @click="currentStepIndex = idx"
              class="px-2.5 py-1 rounded-xl shrink-0 font-medium transition border flex items-center gap-1"
              :class="idx === currentStepIndex && !isFinalStep ? 'bg-amber-500 border-amber-400 text-slate-950 font-bold shadow' : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:text-white'"
            >
              <span>#{{ idx + 1 }}</span>
              <span>{{ log.username }}:</span>
              <span>{{ getActionShortDesc(log) }}</span>
            </button>

            <!-- 终局结算按钮 -->
            <button
              @click="currentStepIndex = replayTotalSteps - 1"
              class="px-3 py-1 rounded-xl shrink-0 font-bold transition border flex items-center gap-1"
              :class="isFinalStep ? 'bg-amber-500 border-amber-400 text-slate-950 shadow' : 'bg-amber-500/10 border-amber-400/40 text-amber-300 hover:bg-amber-500/20'"
            >
              <span>🏆 终局比牌</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import Card from './Card.vue';

const { t } = useI18n();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const tab = ref<'recent' | 'favorites'>('recent');
const handsList = ref<any[]>([]);
const loadingList = ref(false);
const activeHandReplay = ref<any | null>(null);

const currentStepIndex = ref(0);
const isPlaying = ref(false);
let playTimer: any = null;

const favoriteCount = computed(() => {
  return handsList.value.filter(h => h.is_favorite).length;
});

// 总步数 = 所有行动历史 + 1步最终比牌决战
const replayTotalSteps = computed(() => {
  const actionsCount = activeHandReplay.value?.action_history?.length || 0;
  return actionsCount + 1;
});

// 判断当前是否处于最后一步（终局和牌比较与胜者决出）
const isFinalStep = computed(() => {
  const actionsCount = activeHandReplay.value?.action_history?.length || 0;
  return currentStepIndex.value >= actionsCount;
});

// 当前常规行动对象
const currentStep = computed(() => {
  if (!activeHandReplay.value?.action_history) return null;
  if (isFinalStep.value) return null;
  return activeHandReplay.value.action_history[currentStepIndex.value];
});

// 当前公共牌区
const currentCommunityCards = computed(() => {
  if (isFinalStep.value) {
    return activeHandReplay.value?.final_community_cards || [];
  }
  return currentStep.value?.communityCardsAfter || activeHandReplay.value?.final_community_cards || [];
});

// 严格按顺位 (seat 1..N) 排序的玩家数据列表
const replayPlayers = computed(() => {
  let list: any[] = [];
  if (activeHandReplay.value?.settlement?.playerResults?.length) {
    list = activeHandReplay.value.settlement.playerResults.map((pr: any) => {
      const ph = (activeHandReplay.value.player_hands || []).find((h: any) => h.seat === pr.seat);
      return {
        seat: pr.seat,
        userId: pr.userId,
        username: pr.username,
        isWinner: pr.isWinner,
        isFolded: pr.isFolded,
        holeCards: pr.revealedHoleCards?.length ? pr.revealedHoleCards : (ph?.holeCards || []),
        exposedCards: ph?.exposedCards || [],
        bestHand: pr.bestHand || ph?.bestHand,
        doraCount: pr.doraInBestHand || pr.bestHand?.doraCount || 0,
        scoreChange: pr.scoreChange ?? ph?.netScore ?? 0,
      };
    });
  } else if (activeHandReplay.value?.player_hands?.length) {
    list = activeHandReplay.value.player_hands.map((ph: any) => ({
      seat: ph.seat,
      userId: ph.userId,
      username: ph.username,
      isWinner: ph.isWinner,
      isFolded: ph.isFolded,
      holeCards: ph.holeCards || [],
      exposedCards: ph.exposedCards || [],
      bestHand: ph.bestHand,
      doraCount: ph.doraCount || 0,
      scoreChange: ph.netScore || 0,
    }));
  }
  return list.sort((a, b) => a.seat - b.seat);
});

// 获取指定玩家在当前步的手牌快照（无缝向前兼容）
function getPlayerHandAtStep(seat: number) {
  if (isFinalStep.value) {
    const p = replayPlayers.value.find(rp => rp.seat === seat);
    return {
      holeCards: p?.holeCards || [],
      exposedCards: p?.exposedCards || [],
      isFolded: p?.isFolded || false,
    };
  }

  const step = activeHandReplay.value?.action_history?.[currentStepIndex.value];
  if (step?.playerSnapshots) {
    const snap = step.playerSnapshots.find((s: any) => s.seat === seat);
    if (snap) {
      return {
        holeCards: snap.holeCards || [],
        exposedCards: snap.exposedCards || [],
        isFolded: snap.isFolded || false,
      };
    }
  }

  // 旧牌谱兜底：返回终局底牌
  const ph = (activeHandReplay.value?.player_hands || []).find((h: any) => h.seat === seat);
  return {
    holeCards: ph?.holeCards || [],
    exposedCards: ph?.exposedCards || [],
    isFolded: ph?.isFolded || false,
  };
}

function isCardExposed(playerHand: any, card: string): boolean {
  return Array.isArray(playerHand?.exposedCards) && playerHand.exposedCards.includes(card);
}

function isDora(card?: string): boolean {
  if (!card || !activeHandReplay.value?.dora_rank) return false;
  return card[0] === activeHandReplay.value.dora_rank;
}

function isCardInBestHand(card: string, bestHand: any): boolean {
  if (!bestHand || !bestHand.best5Cards) return false;
  return bestHand.best5Cards.includes(card);
}

const currentStepDescription = computed(() => {
  if (!currentStep.value) return '开始复盘';
  return `${currentStep.value.username} 执行了 ${formatActionLog(currentStep.value)}`;
});

function getActionTitle(action: string) {
  switch (action) {
    case 'DISCARD_DRAW': return '弃牌换牌';
    case 'MANIPULATE_SWAP': return '公私置换';
    case 'MANIPULATE_BANISH': return '放逐刷新';
    case 'EXPAND_BOARD': return '增加公牌';
    case 'FOLD': return '弃牌跑路';
    case 'CALL_SHOWDOWN': return '终结决战';
    default: return action;
  }
}

function getActionShortDesc(log: any) {
  switch (log.action) {
    case 'DISCARD_DRAW': return '弃牌换牌';
    case 'MANIPULATE_SWAP': return '公私置换';
    case 'MANIPULATE_BANISH': return '放逐公牌';
    case 'EXPAND_BOARD': return '加公牌';
    case 'FOLD': return '弃牌';
    case 'CALL_SHOWDOWN': return '决战比牌';
    default: return log.action;
  }
}

function formatActionLog(log: any) {
  switch (log.action) {
    case 'DISCARD_DRAW': {
      const faceUp = log.details.discardFaceUp || '?';
      const faceDown = log.details.discardFaceDown
        ? `，暗弃: ${log.details.discardFaceDown}`
        : (log.details.discardFaceDownCount ? `，暗弃: ${log.details.discardFaceDownCount}张` : '');
      return `弃牌换牌 (明弃: ${faceUp}${faceDown}，摸 ${log.details.drawCount} 张)`;
    }
    case 'MANIPULATE_SWAP':
      return `公私置换 (手牌 ${log.details.swappedHandCard} ⇄ 公牌 ${log.details.swappedBoardCard})`;
    case 'MANIPULATE_BANISH':
      return `放逐刷新 (放逐公牌 ${log.details.banishedCard}，牌顶补入 ${log.details.refreshedCard})`;
    case 'EXPAND_BOARD':
      return `增加公牌 (翻开 ${log.details.expandedCard} 加入公区)`;
    case 'FOLD':
      return `弃牌跑路 (扣牌，向底池支付 ${log.details.foldCost} 筹码)`;
    case 'CALL_SHOWDOWN':
      return `终结决战 (全桌开牌决胜)`;
    default:
      return log.action;
  }
}

async function fetchList() {
  loadingList.value = true;
  try {
    const endpoint = tab.value === 'favorites' ? '/api/hands/favorites' : '/api/hands/recent';
    const token = localStorage.getItem('dora_token');
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      handsList.value = await res.json();
    }
  } catch (err) {
    console.error('Failed to fetch hands', err);
  } finally {
    loadingList.value = false;
  }
}

watch(tab, () => {
  fetchList();
});

async function toggleFavorite(hand: any) {
  const token = localStorage.getItem('dora_token');
  const newFav = !hand.is_favorite;
  try {
    const res = await fetch(`/api/hands/${hand.id}/favorite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isFavorite: newFav }),
    });
    if (res.ok) {
      hand.is_favorite = newFav;
      if (tab.value === 'favorites' && !newFav) {
        handsList.value = handsList.value.filter(h => h.id !== hand.id);
      }
    } else {
      const err = await res.json();
      if (err.error === 'FAVORITE_LIMIT_EXCEEDED') {
        alert(t('replay.favoriteLimit'));
      }
    }
  } catch (err) {
    console.error('Failed to toggle favorite', err);
  }
}

async function loadReplay(handId: number) {
  try {
    const res = await fetch(`/api/hands/${handId}/replay`);
    if (res.ok) {
      activeHandReplay.value = await res.json();
      currentStepIndex.value = 0;
      isPlaying.value = false;
    }
  } catch (err) {
    console.error('Failed to load replay', err);
  }
}

function nextStep() {
  if (currentStepIndex.value < replayTotalSteps.value - 1) {
    currentStepIndex.value++;
  } else {
    isPlaying.value = false;
    clearInterval(playTimer);
  }
}

function prevStep() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value--;
  }
}

function toggleAutoPlay() {
  if (isPlaying.value) {
    isPlaying.value = false;
    clearInterval(playTimer);
  } else {
    isPlaying.value = true;
    playTimer = setInterval(() => {
      if (currentStepIndex.value < replayTotalSteps.value - 1) {
        currentStepIndex.value++;
      } else {
        isPlaying.value = false;
        clearInterval(playTimer);
      }
    }, 2000);
  }
}

function exitReplay() {
  activeHandReplay.value = null;
  isPlaying.value = false;
  clearInterval(playTimer);
}

function onClose() {
  exitReplay();
  emit('close');
}

function getPositionName(pos: number) {
  switch (pos) {
    case 1: return t('positions.seat1');
    case 2: return t('positions.seat2');
    case 3: return t('positions.seat3');
    case 4: return t('positions.seat4');
    case 5: return t('positions.seat5');
    default: return `#${pos}`;
  }
}

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString();
}

onMounted(() => {
  fetchList();
});

onUnmounted(() => {
  clearInterval(playTimer);
});
</script>
