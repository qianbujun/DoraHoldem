<template>
  <div class="min-h-screen flex flex-col bg-slate-950 text-slate-100">
    <!-- 全局导航栏 (常驻中英切换、规则、战绩、牌谱与登录状态) -->
    <header class="w-full bg-slate-900/80 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between z-30">
      <div class="flex items-center gap-3 cursor-pointer" @click="returnToLobby">
        <span class="text-2xl">🎴</span>
        <div>
          <h1 class="font-black text-base sm:text-lg tracking-tight text-amber-400">
            {{ $t('game.title') }}
          </h1>
          <span class="text-[10px] text-slate-400 block -mt-1 font-mono">
            {{ $t('game.subTitle') }}
          </span>
        </div>
      </div>

      <!-- 右侧常驻功能群 -->
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- 语言无缝切换按钮 (zh-CN / en-US) -->
        <button
          @click="toggleLanguage"
          class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition flex items-center gap-1 shadow"
        >
          <span>🌐</span>
          <span>{{ currentLocale === 'zh-CN' ? 'English' : '中文' }}</span>
        </button>

        <!-- 亮暗色主题无缝切换按钮 (☀️ / 🌙) -->
        <button
          @click="toggleTheme"
          class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition flex items-center gap-1 shadow"
          :title="currentTheme === 'dark' ? $t('lobby.themeLight') : $t('lobby.themeDark')"
        >
          <span>{{ currentTheme === 'dark' ? '☀️' : '🌙' }}</span>
          <span class="hidden sm:inline">{{ currentTheme === 'dark' ? $t('lobby.themeLight') : $t('lobby.themeDark') }}</span>
        </button>

        <!-- 官方规则说明书弹窗按钮 -->
        <button
          @click="showRulesModal = true"
          class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1"
        >
          <span>📜</span>
          <span class="hidden sm:inline">{{ $t('lobby.rulesBtn') }}</span>
        </button>

        <!-- 牌谱回放按钮 (需登录) -->
        <button
          v-if="user"
          @click="showReplayModal = true"
          class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition flex items-center gap-1"
        >
          <span>📼</span>
          <span class="hidden sm:inline">{{ $t('replay.title') }}</span>
        </button>

        <!-- 个人中心/位置战绩按钮 (需登录) -->
        <button
          v-if="user"
          @click="openStatsModal(user.id)"
          class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-700 transition flex items-center gap-1"
        >
          <span>📊</span>
          <span class="hidden sm:inline">{{ $t('lobby.accountCenter') }}</span>
        </button>

        <!-- 用户名与登出 -->
        <div v-if="user" class="flex items-center gap-2 ml-1">
          <span class="text-xs font-bold text-slate-300 hidden md:inline">
            {{ user.username }}
          </span>
          <button
            @click="handleLogout"
            class="text-xs text-rose-400 hover:text-rose-300 transition"
          >
            {{ $t('lobby.logout') }}
          </button>
        </div>
      </div>
    </header>

    <!-- 主视口 -->
    <main class="flex-1 flex flex-col justify-center items-center p-2 sm:p-4 relative overflow-y-auto">
      <!-- 1. 大厅视图 -->
      <Lobby
        v-if="!currentRoom"
        :user="user"
        @login-success="onLoginSuccess"
        @join-room="joinRoomViaWs"
      />

      <!-- 2. 对战进行中实时桌台视图 (Gaming Table) -->
      <div
        v-else-if="currentGameState"
        class="w-full max-w-5xl flex flex-col justify-between gap-4 flex-1 my-auto animate-fade-in"
      >
        <!-- 顶部其他玩家席位栏 -->
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
          <PlayerSeat
            v-for="p in otherPlayers"
            :key="p.seat"
            :seat="p.seat"
            :userId="p.userId"
            :username="p.username"
            :isDealer="p.seat === currentGameState.dealerSeat"
            :isCurrentTurn="p.seat === currentGameState.currentTurnSeat"
            :isFolded="p.isFolded"
            :foldOrbit="p.foldOrbit"
            :chipScore="p.chipScore"
            :cardCount="p.cardCount"
            :exposedCards="p.exposedCards"
            :faceUpDiscards="p.faceUpDiscards"
            :legalDoraRank="currentGameState.legalDoraRank"
            @view-stats="openStatsModal"
          />
        </div>

        <!-- 中央公共牌桌 (Board) -->
        <Board
          :orbit="currentGameState.currentOrbit"
          :legalDoraRank="currentGameState.legalDoraRank"
          :pot="currentGameState.currentPot"
          :communityCards="currentGameState.communityCards"
          :drawPileCount="currentGameState.drawPileCount"
          :discardPileCount="currentGameState.discardPileCount"
          :selectedCard="selectedBoardCard"
          :isSelectable="isBoardSelectable"
          @select-card="onBoardCardSelect"
        />

        <!-- 实时对局战报横幅与历史行动记录抽屉 (Live Action Log Ticker) -->
        <div class="flex flex-col gap-2">
          <!-- 最新行动横幅通知（帮助玩家看清对手与 AI 的出牌） -->
          <div
            v-if="latestActionMessage"
            class="bg-amber-500/10 border border-amber-500/30 text-amber-300 px-3.5 py-2 rounded-2xl flex items-center justify-between shadow-lg text-xs sm:text-sm animate-fade-in"
          >
            <div class="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
              <span class="text-base shrink-0">📢</span>
              <span class="font-bold truncate">{{ latestActionMessage }}</span>
            </div>
            <button
              @click="showLiveActionDrawer = !showLiveActionDrawer"
              class="text-xs text-amber-400 hover:text-amber-200 underline font-bold shrink-0 ml-2"
            >
              {{ showLiveActionDrawer ? '收起动态' : `查看行动记录 (${gameActionLogs.length})` }}
            </button>
          </div>

          <!-- 展开的实时行动历史记录流 -->
          <div
            v-if="showLiveActionDrawer"
            class="bg-slate-900/95 border border-slate-700 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 max-h-52 overflow-y-auto animate-fade-in"
          >
            <div class="flex items-center justify-between border-b border-slate-800 pb-1.5 text-xs">
              <span class="font-bold text-slate-300 flex items-center gap-1.5">
                <span>📜</span>
                <span>{{ $t('replay.liveActionLog') }} ({{ gameActionLogs.length }})</span>
              </span>
              <button
                @click="showLiveActionDrawer = false"
                class="text-slate-400 hover:text-white px-1.5 py-0.5 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div v-if="gameActionLogs.length === 0" class="text-xs text-slate-500 text-center py-4">
              暂无行动记录，对局正在进行中...
            </div>
            <div v-else class="flex flex-col gap-1.5 text-xs">
              <div
                v-for="(log, idx) in gameActionLogs"
                :key="idx"
                class="p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between gap-2"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-slate-500">#{{ idx + 1 }}</span>
                  <span class="font-bold text-amber-400">[巡目{{ log.orbit }}]</span>
                  <span class="font-bold text-slate-200">{{ log.username }}:</span>
                  <span class="text-slate-300">{{ log.description }}</span>
                </div>
                <span class="text-[10px] text-slate-500 shrink-0 font-mono">{{ log.time }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部：当前用户席位与手牌 -->
        <div v-if="myPlayerState" class="flex flex-col gap-2">
          <PlayerSeat
            :seat="myPlayerState.seat"
            :userId="myPlayerState.userId"
            :username="myPlayerState.username"
            :isDealer="myPlayerState.seat === currentGameState.dealerSeat"
            :isCurrentTurn="myPlayerState.seat === currentGameState.currentTurnSeat"
            isMe
            :isFolded="myPlayerState.isFolded"
            :foldOrbit="myPlayerState.foldOrbit"
            :chipScore="myPlayerState.chipScore"
            :holeCards="myHoleCards"
            :exposedCards="myPlayerState.exposedCards"
            :faceUpDiscards="myPlayerState.faceUpDiscards"
            :selectedCards="selectedHandCards"
            :legalDoraRank="currentGameState.legalDoraRank"
            interactive
            @view-stats="openStatsModal"
            @toggle-select-card="onHandCardSelect"
          />

          <!-- 5 大行动操作面板（轮到自己时唤出） -->
          <ActionPanel
            v-if="isMyTurn && !myPlayerState.isFolded"
            ref="actionPanelRef"
            :currentOrbit="currentGameState.currentOrbit"
            :myHoleCards="myHoleCards"
            :exposedCards="myPlayerState.exposedCards"
            :communityCards="currentGameState.communityCards"
            @action-discard-draw="sendDiscardDraw"
            @action-swap="sendSwap"
            @action-banish="sendBanish"
            @action-expand-board="sendExpandBoard"
            @action-fold="sendFold"
            @action-call-showdown="sendCallShowdown"
          />
        </div>
      </div>

      <!-- 3. 房间等待就绪视图 -->
      <div
        v-else-if="currentRoom"
        class="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col gap-6 text-center animate-fade-in"
      >
        <div>
          <span class="text-xs text-slate-400">房间代码 (Room Code)</span>
          <div class="flex items-center justify-center gap-2 mt-1">
            <span class="text-3xl font-mono font-black text-amber-400 tracking-wider">
              #{{ currentRoom.code }}
            </span>
          </div>
          <span class="text-xs text-slate-400 mt-2 block">
            总局数: {{ currentRoom.totalRounds }} 局 ｜ 目标玩家数: {{ currentRoom.maxPlayers }} 人
          </span>
        </div>

        <!-- 席位列表 -->
        <div class="grid grid-cols-2 gap-3">
          <div
            v-for="s in currentRoom.maxPlayers"
            :key="s"
            class="p-3 rounded-2xl border flex items-center justify-between"
            :class="getSeatPlayer(s) ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-950/40 border-dashed border-slate-800 text-slate-500'"
          >
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-slate-700 text-xs font-bold flex items-center justify-center">
                {{ s }}
              </span>
              <div class="flex flex-col text-left">
                <div class="flex items-center gap-1.5">
                  <span class="font-bold text-xs sm:text-sm text-slate-200">
                    {{ getSeatPlayer(s)?.username || '等待加入...' }}
                  </span>
                  <!-- AI 机器人标记 -->
                  <span
                    v-if="getSeatPlayer(s)?.isAi"
                    class="text-[10px] px-1.5 py-0.2 rounded bg-purple-600/30 text-purple-300 font-bold border border-purple-500/40"
                  >
                    🤖 AI
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span v-if="getSeatPlayer(s)?.isReady" class="text-xs text-emerald-400">已就绪</span>
              <!-- 房主移除 AI 按钮 -->
              <button
                v-if="isRoomOwner && getSeatPlayer(s)?.isAi"
                @click="removeAiBot(s)"
                class="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 px-1.5 py-0.5 rounded transition"
                :title="$t('lobby.removeAi')"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <!-- 房主添加 AI 控制栏 -->
        <div
          v-if="isRoomOwner && currentRoom.playerCount < currentRoom.maxPlayers"
          class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-800/50 p-3 rounded-2xl border border-slate-700/60"
        >
          <div class="flex items-center gap-2 text-xs">
            <span class="text-slate-300 font-bold">🤖 {{ $t('lobby.addAi') }}:</span>
            <select
              v-model="selectedAiDifficulty"
              class="px-2.5 py-1 rounded-xl bg-slate-700 border border-slate-600 text-xs text-amber-300 font-bold focus:outline-none"
            >
              <option value="easy">{{ $t('lobby.aiEasy') }}</option>
              <option value="medium">{{ $t('lobby.aiMedium') }}</option>
              <option value="hard">{{ $t('lobby.aiHard') }}</option>
            </select>
          </div>
          <button
            @click="addAiBot(selectedAiDifficulty)"
            class="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition shadow flex items-center gap-1.5"
          >
            <span>➕</span>
            <span>{{ $t('lobby.addAi') }}</span>
          </button>
        </div>

        <!-- 房主开始对战按钮 -->
        <div class="flex items-center justify-between gap-4 pt-4 border-t border-slate-800">
          <button
            @click="returnToLobby"
            class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
          >
            退出房间
          </button>
          <button
            v-if="isRoomOwner"
            :disabled="currentRoom.playerCount < currentRoom.maxPlayers"
            @click="startGame"
            class="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-xs sm:text-sm transition shadow-lg"
          >
            {{ currentRoom.playerCount < currentRoom.maxPlayers ? `等待满员 (${currentRoom.playerCount}/${currentRoom.maxPlayers})` : '开始首局对战' }}
          </button>
          <span v-else class="text-xs text-slate-400 italic">
            等待房主开局... (当前 {{ currentRoom.playerCount }}/{{ currentRoom.maxPlayers }} 人)
          </span>
        </div>
      </div>
    </main>

    <!-- 弹窗 A: 1~5 号位战绩弹窗 (点击任意玩家唤出) -->
    <PositionStatsModal
      v-if="activeStatsUserId"
      :userId="activeStatsUserId"
      @close="activeStatsUserId = null"
    />

    <!-- 弹窗 B: 官方规则说明书弹窗 (加载规则.md / rules.md) -->
    <RulesModal
      v-if="showRulesModal"
      @close="showRulesModal = false"
    />

    <!-- 弹窗 C: 50 场牌谱与复盘回放器弹窗 -->
    <ReplayViewer
      v-if="showReplayModal"
      @close="showReplayModal = false"
    />

    <!-- 弹窗 D: 单小局结算弹窗 (Showdown Settlement) -->
    <SettlementModal
      v-if="showSettlementModal && currentSettlement"
      :settlement="currentSettlement"
      :isMatchFinished="currentRoom?.status === 'finished'"
      @start-next-round="sendStartNextRound"
      @view-match-finished="showFinalScoreboard = true"
    />

    <!-- 弹窗 E: 整场房间完赛最终总排行榜 -->
    <div
      v-if="showFinalScoreboard"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div class="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl text-center flex flex-col gap-4">
        <div class="text-3xl">🏅</div>
        <h3 class="text-lg font-black text-amber-400">房间终局总积分排行榜</h3>
        <span class="text-xs text-slate-400">总计 {{ currentRoom?.totalRounds }} 局已圆满战毕</span>

        <div class="flex flex-col gap-2 my-2">
          <div
            v-for="(p, rank) in sortedPlayersByScore"
            :key="p.seat"
            class="p-3 rounded-xl border flex items-center justify-between"
            :class="rank === 0 ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold' : 'bg-slate-800/60 border-slate-700 text-slate-200'"
          >
            <div class="flex items-center gap-2">
              <span class="font-black text-sm">#{{ rank + 1 }}</span>
              <span>{{ p.username }} (座位{{ p.seat }})</span>
            </div>
            <span class="font-mono font-black text-base">
              {{ p.cumulativeScore > 0 ? '+' : '' }}{{ p.cumulativeScore }} pts
            </span>
          </div>
        </div>

        <button
          @click="returnToLobby"
          class="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm transition shadow"
        >
          返回游戏大厅
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale } from './i18n.js';
import Lobby from './components/Lobby.vue';
import Board from './components/Board.vue';
import PlayerSeat from './components/PlayerSeat.vue';
import ActionPanel from './components/ActionPanel.vue';
import PositionStatsModal from './components/PositionStatsModal.vue';
import RulesModal from './components/RulesModal.vue';
import ReplayViewer from './components/ReplayViewer.vue';
import SettlementModal from './components/SettlementModal.vue';

const { locale } = useI18n();

const currentLocale = computed(() => locale.value);

function toggleLanguage() {
  const next = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
  setLocale(next);
}

// 主题切换 (Dark / Light)
const currentTheme = ref<'dark' | 'light'>(
  (localStorage.getItem('dora_theme') as 'dark' | 'light') || 'dark'
);

function toggleTheme() {
  currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('dora_theme', currentTheme.value);
  applyTheme();
}

function applyTheme() {
  if (currentTheme.value === 'light') {
    document.documentElement.classList.add('theme-light');
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.remove('theme-light');
    document.documentElement.classList.add('dark');
  }
}

// 用户认证状态
const user = ref<any | null>(null);

// 弹窗状态
const showRulesModal = ref(false);
const showReplayModal = ref(false);
const showSettlementModal = ref(false);
const showFinalScoreboard = ref(false);
const activeStatsUserId = ref<number | null>(null);

// 房间与对局状态
const currentRoom = ref<any | null>(null);
const currentGameState = ref<any | null>(null);
const myHoleCards = ref<string[]>([]);
const currentSettlement = ref<any | null>(null);

// 动作面板引用与交互选中状态
const actionPanelRef = ref<any | null>(null);
const selectedHandCards = ref<string[]>([]);
const selectedBoardCard = ref<string>('');

// 实时对局动态行动记录 (Action Log)
const gameActionLogs = ref<any[]>([]);
const latestActionMessage = ref<string>('');
const showLiveActionDrawer = ref<boolean>(false);

function formatLiveAction(payload: any): string {
  const d = payload.details || {};
  switch (payload.actionType) {
    case 'DISCARD_DRAW': {
      const faceDownStr = d.discardFaceDownCount ? '，暗弃 1 张' : '';
      return `【弃牌换牌】：明弃 ${d.discardFaceUp || '无'}${faceDownStr}，摸入 ${d.drawCount || 0} 张`;
    }
    case 'MANIPULATE_SWAP':
      return `【公私置换】：换出手中 ${d.swappedHandCard} ⇄ 换入公牌 ${d.swappedBoardCard}`;
    case 'MANIPULATE_BANISH':
      return `【放逐刷新】：放逐公牌 ${d.banishedCard}，牌顶翻出 ${d.refreshedCard} 补入公区`;
    case 'EXPAND_BOARD':
      return `【增加公牌】：牌堆顶翻出 ${d.expandedCard} 加入公牌（公牌数+1）`;
    case 'FOLD':
      return `【弃牌跑路】：支付 ${d.foldCost} 筹码进底池，扣牌离场`;
    case 'CALL_SHOWDOWN':
      return `【终结决战】：立即开牌比较大小！`;
    default:
      return payload.actionType || '出牌行动';
  }
}

let ws: WebSocket | null = null;

const isRoomOwner = computed(() => {
  return currentRoom.value && user.value && currentRoom.value.ownerId === user.value.id;
});

const myPlayerState = computed(() => {
  if (!currentGameState.value || !user.value) return null;
  return currentGameState.value.players.find((p: any) => p.userId === user.value.id);
});

const otherPlayers = computed(() => {
  if (!currentGameState.value || !user.value) return [];
  return currentGameState.value.players.filter((p: any) => p.userId !== user.value.id);
});

const isMyTurn = computed(() => {
  return myPlayerState.value && currentGameState.value?.currentTurnSeat === myPlayerState.value.seat;
});

const isBoardSelectable = computed(() => {
  return isMyTurn.value && actionPanelRef.value?.currentMode === 'manipulate';
});

const sortedPlayersByScore = computed(() => {
  if (!currentRoom.value?.players) return [];
  return [...currentRoom.value.players].sort((a, b) => b.cumulativeScore - a.cumulativeScore);
});

function getSeatPlayer(seat: number) {
  return currentRoom.value?.players?.find((p: any) => p.seat === seat);
}

function openStatsModal(userId: number) {
  activeStatsUserId.value = userId;
}

function returnToLobby() {
  if (currentRoom.value) {
    sendWs('C2S_LEAVE_ROOM', {});
  }
  currentRoom.value = null;
  currentGameState.value = null;
  currentSettlement.value = null;
  myHoleCards.value = [];
  showSettlementModal.value = false;
  showFinalScoreboard.value = false;
}

function handleLogout() {
  localStorage.removeItem('dora_token');
  user.value = null;
  returnToLobby();
}

function onLoginSuccess(userData: any, token: string) {
  user.value = userData;
  initWebSocket();
}

// WebSocket 连接与报文处理
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to Dora Hold\'em Game Server');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error(e);
    }
  };

  ws.onclose = () => {
    console.warn('[WS] Disconnected, reconnecting in 3s...');
    setTimeout(initWebSocket, 3000);
  };
}

function sendWs(event: string, payload: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const token = localStorage.getItem('dora_token');
    ws.send(JSON.stringify({ event, payload, token }));
  }
}

function handleWsMessage(msg: { event: string; payload: any }) {
  const { event, payload } = msg;

  switch (event) {
    case 'S2C_ROOM_UPDATE':
      currentRoom.value = payload;
      if (payload.status === 'waiting') {
        currentGameState.value = null;
      }
      break;

    case 'S2C_ROUND_START':
      if (currentRoom.value) {
        currentRoom.value.status = 'playing';
      }
      currentGameState.value = payload;
      showSettlementModal.value = false;
      selectedHandCards.value = [];
      selectedBoardCard.value = '';
      gameActionLogs.value = [];
      latestActionMessage.value = '';
      showLiveActionDrawer.value = false;
      break;

    case 'S2C_GAME_STATE':
      if (currentRoom.value) {
        currentRoom.value.status = 'playing';
      }
      currentGameState.value = payload;
      break;

    case 'S2C_PRIVATE_HOLE_CARDS':
      myHoleCards.value = payload.holeCards;
      break;

    case 'S2C_PRIVATE_DRAW_RESULT':
      myHoleCards.value = payload.currentHoleCards;
      break;

    case 'S2C_ACTION_EVENT':
      if (payload.publicState) {
        currentGameState.value = payload.publicState;
      }
      {
        const actorName = payload.username || `Seat ${payload.actingSeat}`;
        const desc = formatLiveAction(payload);
        const logItem = {
          orbit: payload.orbit || currentGameState.value?.currentOrbit || 1,
          seat: payload.actingSeat,
          username: actorName,
          actionType: payload.actionType,
          details: payload.details,
          description: desc,
          time: new Date().toLocaleTimeString(),
        };
        gameActionLogs.value.push(logItem);
        latestActionMessage.value = `[巡目${logItem.orbit}] ${actorName} 执行了 ${desc}`;
      }
      break;

    case 'S2C_SHOWDOWN_RESULT':
      currentSettlement.value = payload.settlement;
      if (payload.roomInfo) {
        currentRoom.value = payload.roomInfo;
      }
      showSettlementModal.value = true;
      break;

    case 'S2C_MATCH_FINISHED':
      currentRoom.value = payload;
      showFinalScoreboard.value = true;
      break;

    case 'S2C_ERROR':
      alert(`[Game Error] ${payload.message}`);
      break;
  }
}

const selectedAiDifficulty = ref<'easy' | 'medium' | 'hard'>('medium');

function addAiBot(difficulty: 'easy' | 'medium' | 'hard') {
  sendWs('C2S_ADD_AI', { difficulty });
}

function removeAiBot(seat: number) {
  sendWs('C2S_REMOVE_AI', { seat });
}

function joinRoomViaWs(code: string, password?: string, targetSeat?: number) {
  sendWs('C2S_JOIN_ROOM', { roomCode: code, password, targetSeat });
}

function startGame() {
  sendWs('C2S_START_GAME', {});
}

function sendStartNextRound() {
  sendWs('C2S_START_NEXT_ROUND', {});
  showSettlementModal.value = false;
}

// 出牌交互
function onHandCardSelect(card: string) {
  if (actionPanelRef.value) {
    actionPanelRef.value.handleCardSelection(card, true);
  }
}

function onBoardCardSelect(card: string) {
  selectedBoardCard.value = card;
  if (actionPanelRef.value) {
    actionPanelRef.value.handleCardSelection(card, false);
  }
}

function sendDiscardDraw(data: { discardFaceUp: string; discardFaceDown?: string }) {
  sendWs('C2S_ACTION_DISCARD_DRAW', data);
}

function sendSwap(data: { handCard: string; boardCard: string }) {
  sendWs('C2S_ACTION_SWAP', data);
}

function sendBanish(data: { boardCard: string }) {
  sendWs('C2S_ACTION_BANISH', data);
}

function sendExpandBoard() {
  sendWs('C2S_ACTION_EXPAND_BOARD', {});
}

function sendFold() {
  sendWs('C2S_ACTION_FOLD', {});
}

function sendCallShowdown() {
  sendWs('C2S_ACTION_CALL_SHOWDOWN', {});
}

onMounted(async () => {
  applyTheme();
  const token = localStorage.getItem('dora_token');
  if (token) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        user.value = await res.json();
        initWebSocket();
      } else {
        localStorage.removeItem('dora_token');
      }
    } catch (e) {
      console.error(e);
    }
  }
});
</script>

