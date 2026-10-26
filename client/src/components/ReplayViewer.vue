<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
    <div class="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-3xl p-4 sm:p-6 shadow-2xl text-slate-100 flex flex-col gap-4 max-h-[92vh]">
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
                class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow transition flex items-center gap-1"
              >
                <span>▶</span>
                <span>复盘</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 视图 B: 复盘回放器（含各家手牌、和牌与单步调试） -->
      <div v-else class="flex flex-col gap-3 flex-1 overflow-hidden">
        <!-- 局情概要条与模式切换 -->
        <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700/80 text-xs">
          <!-- 局情统计 -->
          <div class="flex items-center gap-3 font-medium text-slate-300">
            <span>第 <b class="text-amber-400">{{ activeHandReplay.round_number }}</b> 局</span>
            <span>|</span>
            <span>宝牌: <b class="text-amber-400">{{ activeHandReplay.dora_rank }}</b></span>
            <span>|</span>
            <span>巡目: <b>{{ activeHandReplay.final_orbit }}</b></span>
            <span>|</span>
            <span>底分: <b class="text-amber-300">{{ activeHandReplay.base_score }}</b></span>
            <span>|</span>
            <span class="text-slate-400">{{ $t('endReasons.' + activeHandReplay.end_reason) }}</span>
          </div>

          <!-- 子视图切换按钮 (手牌成牌 vs 单步流) -->
          <div class="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              @click="replaySubTab = 'showdown'"
              class="px-3 py-1 rounded-lg font-bold text-xs transition"
              :class="replaySubTab === 'showdown' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'"
            >
              🃏 {{ $t('replay.showdownHands') }}
            </button>
            <button
              @click="replaySubTab = 'steps'"
              class="px-3 py-1 rounded-lg font-bold text-xs transition"
              :class="replaySubTab === 'steps' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'"
            >
              🎬 {{ $t('replay.title') }}
            </button>
            <button
              @click="exitReplay"
              class="ml-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
            >
              {{ $t('replay.exit') }}
            </button>
          </div>
        </div>

        <!-- 子视图 1: 各家手牌与和牌判决大卡片 (专门方便复盘) -->
        <div v-if="replaySubTab === 'showdown'" class="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          <!-- 终局公共牌展示 -->
          <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span class="font-bold text-slate-300">终局公共牌区 (Community Cards)：</span>
              <span>共 {{ activeHandReplay.final_community_cards?.length || 0 }} 张</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div v-for="card in activeHandReplay.final_community_cards" :key="card">
                <Card
                  :card="card"
                  :isDora="card[0] === activeHandReplay.dora_rank"
                  size="sm"
                />
              </div>
            </div>
          </div>

          <!-- 各玩家手牌与和牌结果列表 -->
          <div class="flex flex-col gap-2.5">
            <div
              v-for="p in replayPlayers"
              :key="p.seat"
              class="p-3.5 rounded-2xl border transition flex flex-col gap-2.5"
              :class="p.isWinner ? 'bg-amber-950/20 border-amber-500/50 shadow-lg' : 'bg-slate-950/50 border-slate-800'"
            >
              <!-- 玩家头栏 -->
              <div class="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div class="flex items-center gap-2">
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
                </div>

                <!-- 结果徽章与净胜分 -->
                <div class="flex items-center gap-3">
                  <span
                    class="text-xs font-bold px-2 py-0.5 rounded-full"
                    :class="p.isWinner ? 'bg-amber-400 text-slate-950 shadow font-black' : (p.isFolded ? 'bg-slate-800 text-slate-400' : 'bg-rose-500/20 text-rose-300')"
                  >
                    {{ p.isWinner ? $t('replay.winnerBadge') : (p.isFolded ? $t('roles.foldedPlayer') : $t('roles.activeLoser')) }}
                  </span>
                  <span
                    class="font-black text-sm sm:text-base font-mono"
                    :class="p.scoreChange > 0 ? 'text-amber-400' : (p.scoreChange < 0 ? 'text-rose-400' : 'text-slate-400')"
                  >
                    {{ p.scoreChange > 0 ? '+' : '' }}{{ p.scoreChange }}
                  </span>
                </div>
              </div>

              <!-- 手牌区与成牌区对比 -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <!-- 手牌底牌 (Hole Cards) -->
                <div class="flex flex-col gap-1.5 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                  <span class="text-slate-400 font-semibold">{{ $t('replay.holeCards') }}：</span>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <Card
                      v-for="card in p.holeCards"
                      :key="card"
                      :card="card"
                      :isExposed="isCardExposed(p, card)"
                      :isDora="card[0] === activeHandReplay.dora_rank"
                      size="sm"
                    />
                  </div>
                </div>

                <!-- 和牌最佳 5 张牌 (Best 5 Cards) -->
                <div class="flex flex-col gap-1.5 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                  <div class="flex items-center justify-between">
                    <span class="text-slate-400 font-semibold">{{ $t('replay.bestHand') }}：</span>
                    <span v-if="p.bestHand" class="font-bold text-amber-300">
                      {{ $t(p.bestHand.rankNameKey) }}
                      <span v-if="p.doraCount > 0" class="text-amber-400 ml-1">
                        ({{ $t('replay.doraBonus', { count: p.doraCount }) }})
                      </span>
                    </span>
                  </div>
                  <div v-if="p.bestHand && p.bestHand.best5Cards" class="flex items-center gap-1.5 flex-wrap">
                    <Card
                      v-for="card in p.bestHand.best5Cards"
                      :key="card"
                      :card="card"
                      :isDora="card[0] === activeHandReplay.dora_rank"
                      size="sm"
                    />
                  </div>
                  <div v-else class="text-slate-500 italic py-2">
                    {{ $t('replay.noBestHandFolded') }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 子视图 2: 单步/自动复盘回放器 -->
        <div v-else class="flex flex-col gap-3 flex-1 overflow-hidden">
          <!-- 进度与控制栏 -->
          <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-800/70 p-3 rounded-2xl border border-slate-700">
            <div class="flex items-center gap-2 text-xs sm:text-sm font-bold">
              <span class="text-amber-400">{{ $t('replay.step', { current: currentStepIndex + 1, total: replayTotalSteps }) }}</span>
              <span class="text-slate-400">|</span>
              <span>巡目: {{ currentStep?.orbit || 1 }}</span>
            </div>

            <!-- 单步调试与播放按钮群 -->
            <div class="flex items-center gap-2">
              <button
                :disabled="currentStepIndex <= 0"
                @click="prevStep"
                class="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-xs font-bold transition"
              >
                {{ $t('replay.stepBackward') }}
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
                {{ $t('replay.stepForward') }}
              </button>
            </div>
          </div>

          <!-- 步骤事件说明与公共牌区复现 -->
          <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
              <span class="text-sm font-bold text-amber-300">
                {{ currentStepDescription }}
              </span>
            </div>

            <!-- 公共牌实时状态 -->
            <div class="pt-2 border-t border-slate-800/80">
              <div class="text-xs text-slate-400 mb-2">当前公区牌面：</div>
              <div class="flex flex-wrap items-center gap-2">
                <div
                  v-for="card in currentCommunityCards"
                  :key="card"
                >
                  <Card
                    :card="card"
                    :isDora="card[0] === activeHandReplay.dora_rank"
                    size="sm"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 历史行动完整日志流 (点击单行可直接跳转到该步) -->
          <div class="flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5 text-xs text-slate-400 bg-slate-950/40 p-3 rounded-2xl border border-slate-900">
            <div
              v-for="(log, idx) in activeHandReplay.action_history"
              :key="idx"
              @click="currentStepIndex = idx"
              class="p-2 rounded-xl transition flex items-center justify-between cursor-pointer"
              :class="idx === currentStepIndex ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30' : 'hover:bg-slate-800/50'"
            >
              <span>#{{ idx + 1 }} [巡目{{ log.orbit }}] {{ log.username }}: {{ formatActionLog(log) }}</span>
              <span class="text-[10px] text-slate-500">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            </div>
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
const replaySubTab = ref<'showdown' | 'steps'>('showdown');
const handsList = ref<any[]>([]);
const loadingList = ref(false);
const activeHandReplay = ref<any | null>(null);

const currentStepIndex = ref(0);
const isPlaying = ref(false);
let playTimer: any = null;

const favoriteCount = computed(() => {
  return handsList.value.filter(h => h.is_favorite).length;
});

const replayPlayers = computed(() => {
  if (activeHandReplay.value?.settlement?.playerResults?.length) {
    return activeHandReplay.value.settlement.playerResults.map((pr: any) => {
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
    return activeHandReplay.value.player_hands.map((ph: any) => ({
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
  return [];
});

function isCardExposed(player: any, card: string): boolean {
  return Array.isArray(player?.exposedCards) && player.exposedCards.includes(card);
}

const replayTotalSteps = computed(() => {
  return activeHandReplay.value?.action_history?.length || 0;
});

const currentStep = computed(() => {
  if (!activeHandReplay.value?.action_history) return null;
  return activeHandReplay.value.action_history[currentStepIndex.value];
});

const currentCommunityCards = computed(() => {
  return currentStep.value?.communityCardsAfter || activeHandReplay.value?.final_community_cards || [];
});

const currentStepDescription = computed(() => {
  if (!currentStep.value) return '开始回放';
  return `${currentStep.value.username} 执行了 ${formatActionLog(currentStep.value)}`;
});

function formatActionLog(log: any) {
  switch (log.action) {
    case 'DISCARD_DRAW':
      return `弃牌换牌 (明牌: ${log.details.discardFaceUp}, 暗牌: ${log.details.discardFaceDownCount || 0}张, 摸${log.details.drawCount}张)`;
    case 'MANIPULATE_SWAP':
      return `公私置换 (手牌 ${log.details.swappedHandCard} ⇄ 公牌 ${log.details.swappedBoardCard})`;
    case 'MANIPULATE_BANISH':
      return `放逐刷新 (放逐公牌 ${log.details.banishedCard}，牌顶补入 ${log.details.refreshedCard})`;
    case 'EXPAND_BOARD':
      return `增加公牌 (翻开 ${log.details.expandedCard} 加入公区)`;
    case 'FOLD':
      return `弃牌跑路 (扣牌，向底池支付 ${log.details.foldCost} 筹码)`;
    case 'CALL_SHOWDOWN':
      return `终结决战 (立即开牌比较大小)`;
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
      replaySubTab.value = 'showdown';
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
      nextStep();
    }, 1500);
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

