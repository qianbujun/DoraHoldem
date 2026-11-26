<template>
  <div class="min-h-screen flex flex-col bg-slate-950 text-slate-100">
    <!-- 全局导航栏 (常驻中英切换、规则、战绩、牌谱与登录状态) -->
    <header class="w-full bg-slate-900/80 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between z-30">
      <div class="flex items-center gap-3 cursor-pointer" @click="returnToLobby(true)">
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
        <!-- 连接心跳状态指示 -->
        <div
          v-if="user"
          class="px-2.5 py-1 rounded-full text-[11px] font-bold border flex items-center gap-1.5"
          :class="wsStatus === 'connected'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-amber-500/15 border-amber-500/40 text-amber-300 animate-pulse'"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="wsStatus === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'"
          ></span>
          <span class="hidden md:inline">
            {{ wsStatus === 'connected' ? $t('connection.connected') : (wsStatus === 'connecting' ? $t('connection.connecting') : $t('connection.reconnecting')) }}
          </span>
        </div>

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
      <!-- 全局状态提示条（如原房间超时过期等） -->
      <div
        v-if="noticeMessage"
        class="w-full max-w-2xl mb-3 px-4 py-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs sm:text-sm flex items-center justify-between gap-3"
      >
        <span>{{ noticeMessage }}</span>
        <button @click="noticeMessage = ''" class="text-amber-300 hover:text-white font-bold">✕</button>
      </div>

      <!-- 0. 正在断线/刷新重连恢复状态 -->
      <div
        v-if="isRestoringSession && !currentRoom"
        class="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-3 text-center"
      >
        <div class="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-sm font-bold text-amber-300">{{ $t('connection.restoring') }}</span>
      </div>

      <!-- 1. 大厅视图 -->
      <Lobby
        v-else-if="!currentRoom"
        :user="user"
        @login-success="onLoginSuccess"
        @join-room="joinRoomViaWs"
      />

      <!-- 2. 对战进行中实时桌台视图 (Gaming Table) -->
      <div
        v-else-if="currentGameState"
        class="w-full max-w-5xl flex flex-col justify-between gap-4 flex-1 my-auto animate-fade-in"
      >
        <!-- 对局房间信息与任意玩家可发起本小回合后结束游戏控制栏 -->
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-2">
            <span class="font-mono font-black text-amber-400">#{{ currentRoom?.code }}</span>
            <span class="text-slate-400">·</span>
            <span class="font-semibold text-slate-200">
              第 {{ currentGameState.roundNumber }} / {{ currentRoom?.totalRounds || currentGameState.totalRounds }} 局
            </span>
            <span
              v-if="wsStatus !== 'connected'"
              class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold animate-pulse"
            >
              {{ $t('connection.reconnecting') }}
            </span>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <template v-if="currentRoom?.endAfterCurrentRound">
              <span class="px-2.5 py-1 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 font-bold">
                ⏳ {{ $t('match.pendingEndBanner', { username: currentRoom.endRequestedBy?.username || '' }) }}
              </span>
              <button
                v-if="currentRoom.endRequestedBy?.userId === user?.id"
                @click="cancelEndGame"
                class="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-bold transition"
              >
                {{ $t('match.withdrawEndBtn') }}
              </button>
            </template>
            <template v-else-if="currentRoom?.status === 'playing'">
              <button
                v-if="!confirmEndAfterRound"
                @click="confirmEndAfterRound = true"
                class="px-3 py-1 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 font-bold transition"
              >
                🏁 {{ $t('match.endAfterRoundBtn') }}
              </button>
              <div v-else class="flex items-center gap-1.5 bg-rose-950/60 border border-rose-500/50 px-2.5 py-1 rounded-xl">
                <span class="text-rose-200 font-semibold">{{ $t('match.endAfterRoundConfirm') }}</span>
                <button
                  @click="requestEndGame"
                  class="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition"
                >
                  {{ $t('match.confirmEnd') }}
                </button>
                <button
                  @click="confirmEndAfterRound = false"
                  class="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
                >
                  {{ $t('match.cancel') }}
                </button>
              </div>
            </template>
          </div>
        </div>

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
            :isOnline="isSeatOnline(p.seat)"
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
            :isOnline="isSeatOnline(myPlayerState.seat)"
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
                  <span
                    v-else-if="getSeatPlayer(s) && getSeatPlayer(s)?.isOnline === false"
                    class="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40"
                  >
                    🔌 {{ $t('connection.offlineBadge') }}
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
              <option value="ultimate">{{ $t('lobby.aiUltimate') }}</option>
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
            @click="returnToLobby(false)"
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
      :endedEarly="currentRoom?.endedEarly"
      :endedByName="currentRoom?.endedBy?.username"
      :currentRound="currentRoom?.currentRound"
      :totalRounds="currentRoom?.totalRounds"
      @start-next-round="sendStartNextRound"
      @view-match-finished="openFinalScoreboard"
      @end-match-now="requestEndGame"
    />

    <!-- 弹窗 E: 整场房间完赛最终总排行榜 -->
    <div
      v-if="showFinalScoreboard"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div class="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl text-center flex flex-col gap-4">
        <div class="text-3xl">🏅</div>
        <h3 class="text-lg font-black text-amber-400">房间终局总积分排行榜</h3>
        <span class="text-xs text-slate-400">
          {{ currentRoom?.endedEarly
            ? $t('match.endedEarlySubtitle', { completed: currentRoom?.currentRound || 0, total: currentRoom?.totalRounds || 0, username: currentRoom?.endedBy?.username || '' })
            : $t('match.completedAllSubtitle', { total: currentRoom?.totalRounds || 0 }) }}
        </span>

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

        <div class="flex flex-col gap-2">
          <button
            v-if="currentSettlement"
            @click="viewLastSettlementFromScoreboard"
            class="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition"
          >
            {{ $t('match.viewLastSettlement') }}
          </button>
          <button
            @click="returnToLobby(false)"
            class="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm transition shadow"
          >
            返回游戏大厅
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
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

const { locale, t } = useI18n();

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

const ACTIVE_ROOM_KEY = 'dora_active_room';
const HEARTBEAT_INTERVAL_MS = 15000;
const PONG_TIMEOUT_MS = 8000;
const VISIBILITY_PING_TIMEOUT_MS = 3500;

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
const confirmEndAfterRound = ref(false);
const noticeMessage = ref('');

// WebSocket 连接与恢复状态
const wsStatus = ref<'disconnected' | 'connecting' | 'connected'>('disconnected');
const isAuthenticatedWs = ref(false);
const isRestoringSession = ref(false);

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
let shouldKeepConnected = false;
let lastMessageAt = 0;
let reconnectAttempts = 0;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let pongTimeoutTimer: number | null = null;
let restoreFallbackTimer: number | null = null;
let pendingWsQueue: Array<{ event: string; payload: any }> = [];

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

function isSeatOnline(seat: number): boolean {
  const rp = getSeatPlayer(seat);
  if (!rp) return true;
  if (rp.isAi) return true;
  return rp.isOnline !== false;
}

function openStatsModal(userId: number) {
  activeStatsUserId.value = userId;
}

function openFinalScoreboard() {
  showSettlementModal.value = false;
  showFinalScoreboard.value = true;
}

function viewLastSettlementFromScoreboard() {
  showFinalScoreboard.value = false;
  showSettlementModal.value = true;
}

function clearLocalRoomState() {
  localStorage.removeItem(ACTIVE_ROOM_KEY);
  currentRoom.value = null;
  currentGameState.value = null;
  currentSettlement.value = null;
  myHoleCards.value = [];
  showSettlementModal.value = false;
  showFinalScoreboard.value = false;
  confirmEndAfterRound.value = false;
  gameActionLogs.value = [];
  latestActionMessage.value = '';
  showLiveActionDrawer.value = false;
}

function returnToLobby(askConfirm: boolean = false) {
  if (
    askConfirm &&
    currentRoom.value &&
    (currentRoom.value.status === 'playing' || currentRoom.value.status === 'round_end')
  ) {
    if (!window.confirm(t('match.confirmLeaveActiveGame'))) {
      return;
    }
  }
  if (currentRoom.value) {
    sendWs('C2S_LEAVE_ROOM', {});
  }
  clearLocalRoomState();
}

function handleLogout() {
  localStorage.removeItem('dora_token');
  returnToLobby(false);
  user.value = null;
  closeWsCleanly();
}

function onLoginSuccess(userData: any, _token: string) {
  user.value = userData;
  noticeMessage.value = '';
  initWebSocket();
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearHeartbeatTimers() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (pongTimeoutTimer !== null) {
    clearTimeout(pongTimeoutTimer);
    pongTimeoutTimer = null;
  }
}

function closeWsCleanly() {
  shouldKeepConnected = false;
  clearReconnectTimer();
  clearHeartbeatTimers();
  if (restoreFallbackTimer !== null) {
    clearTimeout(restoreFallbackTimer);
    restoreFallbackTimer = null;
  }
  pendingWsQueue = [];
  isAuthenticatedWs.value = false;
  isRestoringSession.value = false;
  wsStatus.value = 'disconnected';
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }
}

function sendPingWithTimeout(socket: WebSocket, timeoutMs: number) {
  if (socket !== ws || socket.readyState !== WebSocket.OPEN) return;
  try {
    const token = localStorage.getItem('dora_token');
    socket.send(JSON.stringify({ event: 'C2S_PING', payload: { timestamp: Date.now() }, token }));
  } catch {
    return;
  }
  if (pongTimeoutTimer !== null) {
    clearTimeout(pongTimeoutTimer);
  }
  pongTimeoutTimer = window.setTimeout(() => {
    pongTimeoutTimer = null;
    if (socket !== ws) return;
    console.warn('[WS] Heartbeat pong timeout, forcing reconnect...');
    socket.close();
  }, timeoutMs);
}

function startHeartbeat(socket: WebSocket) {
  clearHeartbeatTimers();
  heartbeatTimer = window.setInterval(() => {
    if (socket !== ws || socket.readyState !== WebSocket.OPEN) {
      clearHeartbeatTimers();
      return;
    }
    sendPingWithTimeout(socket, PONG_TIMEOUT_MS);
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleReconnect() {
  if (!shouldKeepConnected || !user.value) return;
  if (reconnectTimer !== null) return;
  const delay = Math.min(500 * Math.pow(2, reconnectAttempts), 5000);
  reconnectAttempts += 1;
  console.warn(`[WS] Disconnected, reconnecting in ${delay}ms...`);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    initWebSocket();
  }, delay);
}

function checkOrRecoverConnection() {
  if (!user.value || !shouldKeepConnected) return;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    reconnectAttempts = 0;
    clearReconnectTimer();
    initWebSocket();
    return;
  }
  if (ws.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > 5000) {
    sendPingWithTimeout(ws, VISIBILITY_PING_TIMEOUT_MS);
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    checkOrRecoverConnection();
  }
}

function handleWindowFocusOrOnline() {
  checkOrRecoverConnection();
}

// WebSocket 连接与报文处理
function initWebSocket() {
  if (!user.value) return;
  clearReconnectTimer();
  clearHeartbeatTimers();
  shouldKeepConnected = true;

  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  wsStatus.value = 'connecting';
  isAuthenticatedWs.value = false;

  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.onopen = () => {
    if (socket !== ws) return;
    console.log('[WS] Connected to Dora Hold\'em Game Server');
    wsStatus.value = 'connected';
    reconnectAttempts = 0;
    lastMessageAt = Date.now();
    startHeartbeat(socket);

    const token = localStorage.getItem('dora_token');
    const preferredRoomCode = currentRoom.value?.code || localStorage.getItem(ACTIVE_ROOM_KEY) || undefined;
    socket.send(JSON.stringify({
      event: 'C2S_AUTH',
      payload: { preferredRoomCode },
      token,
    }));
  };

  socket.onmessage = (event) => {
    if (socket !== ws) return;
    lastMessageAt = Date.now();
    if (pongTimeoutTimer !== null) {
      clearTimeout(pongTimeoutTimer);
      pongTimeoutTimer = null;
    }
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error(e);
    }
  };

  socket.onclose = () => {
    if (socket !== ws) return;
    wsStatus.value = 'disconnected';
    isAuthenticatedWs.value = false;
    clearHeartbeatTimers();
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (socket !== ws) return;
    // onclose 将负责按退避重连
  };
}

function flushPendingQueue() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !isAuthenticatedWs.value) return;
  const queued = [...pendingWsQueue];
  pendingWsQueue = [];
  const token = localStorage.getItem('dora_token');
  for (const item of queued) {
    ws.send(JSON.stringify({ event: item.event, payload: item.payload, token }));
  }
}

function sendWs(event: string, payload: any) {
  if (ws && ws.readyState === WebSocket.OPEN && (isAuthenticatedWs.value || event === 'C2S_PING' || event === 'C2S_AUTH')) {
    const token = localStorage.getItem('dora_token');
    ws.send(JSON.stringify({ event, payload, token }));
    return;
  }
  if (event !== 'C2S_PING' && event !== 'C2S_AUTH') {
    pendingWsQueue.push({ event, payload });
  }
  if (user.value && (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
    reconnectAttempts = 0;
    initWebSocket();
  }
}

function handleWsMessage(msg: { event: string; payload: any }) {
  const { event, payload } = msg;

  switch (event) {
    case 'S2C_PONG':
      break;

    case 'S2C_AUTH_RESULT':
      isRestoringSession.value = false;
      if (restoreFallbackTimer !== null) {
        clearTimeout(restoreFallbackTimer);
        restoreFallbackTimer = null;
      }
      if (payload.authenticated) {
        isAuthenticatedWs.value = true;
        if (payload.restoredRoomCode) {
          localStorage.setItem(ACTIVE_ROOM_KEY, payload.restoredRoomCode);
          noticeMessage.value = '';
        } else {
          const hadSavedRoom = Boolean(localStorage.getItem(ACTIVE_ROOM_KEY) || currentRoom.value);
          if (hadSavedRoom && !pendingWsQueue.some(q => q.event === 'C2S_JOIN_ROOM')) {
            if (currentRoom.value) {
              noticeMessage.value = t('connection.roomExpired');
            }
            clearLocalRoomState();
          } else {
            localStorage.removeItem(ACTIVE_ROOM_KEY);
          }
        }
        flushPendingQueue();
      } else {
        isAuthenticatedWs.value = false;
      }
      break;

    case 'S2C_ROOM_UPDATE':
      currentRoom.value = payload;
      if (payload?.code) {
        localStorage.setItem(ACTIVE_ROOM_KEY, payload.code);
      }
      if (!payload?.endAfterCurrentRound) {
        confirmEndAfterRound.value = false;
      }
      if (payload.status === 'waiting') {
        currentGameState.value = null;
        currentSettlement.value = null;
        showSettlementModal.value = false;
        showFinalScoreboard.value = false;
      }
      break;

    case 'S2C_ROUND_START':
      if (currentRoom.value) {
        currentRoom.value.status = 'playing';
        currentRoom.value.endAfterCurrentRound = false;
        currentRoom.value.endRequestedBy = undefined;
      }
      currentGameState.value = payload;
      showSettlementModal.value = false;
      showFinalScoreboard.value = false;
      confirmEndAfterRound.value = false;
      selectedHandCards.value = [];
      selectedBoardCard.value = '';
      gameActionLogs.value = [];
      latestActionMessage.value = '';
      showLiveActionDrawer.value = false;
      break;

    case 'S2C_GAME_STATE':
      if (currentRoom.value && currentRoom.value.status === 'waiting' && !payload.isHandFinished) {
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

    case 'S2C_SYNC_ACTION_LOGS': {
      const logs = Array.isArray(payload?.logs) ? payload.logs : [];
      gameActionLogs.value = logs.map((l: any) => {
        const actorName = l.username || `Seat ${l.seat}`;
        const desc = formatLiveAction(l);
        return {
          orbit: l.orbit || 1,
          seat: l.seat,
          username: actorName,
          actionType: l.actionType,
          details: l.details,
          description: desc,
          time: l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '',
        };
      });
      if (gameActionLogs.value.length > 0) {
        const last = gameActionLogs.value[gameActionLogs.value.length - 1];
        latestActionMessage.value = `[巡目${last.orbit}] ${last.username} 执行了 ${last.description}`;
      } else {
        latestActionMessage.value = '';
      }
      break;
    }

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
      if (!showFinalScoreboard.value) {
        showSettlementModal.value = true;
      }
      break;

    case 'S2C_MATCH_FINISHED':
      currentRoom.value = payload;
      showSettlementModal.value = false;
      showFinalScoreboard.value = true;
      confirmEndAfterRound.value = false;
      break;

    case 'S2C_ERROR':
      alert(`[Game Error] ${payload.message}`);
      break;
  }
}

const selectedAiDifficulty = ref<'easy' | 'medium' | 'hard' | 'ultimate'>('medium');

function addAiBot(difficulty: 'easy' | 'medium' | 'hard' | 'ultimate') {
  sendWs('C2S_ADD_AI', { difficulty });
}

function removeAiBot(seat: number) {
  sendWs('C2S_REMOVE_AI', { seat });
}

function joinRoomViaWs(code: string, password?: string, targetSeat?: number) {
  noticeMessage.value = '';
  sendWs('C2S_JOIN_ROOM', { roomCode: code, password, targetSeat });
}

function startGame() {
  sendWs('C2S_START_GAME', {});
}

function sendStartNextRound() {
  sendWs('C2S_START_NEXT_ROUND', {});
  showSettlementModal.value = false;
}

function requestEndGame() {
  confirmEndAfterRound.value = false;
  sendWs('C2S_REQUEST_END_GAME', {});
}

function cancelEndGame() {
  sendWs('C2S_CANCEL_END_GAME', {});
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
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleWindowFocusOrOnline);
  window.addEventListener('online', handleWindowFocusOrOnline);

  const token = localStorage.getItem('dora_token');
  if (token) {
    if (localStorage.getItem(ACTIVE_ROOM_KEY)) {
      isRestoringSession.value = true;
      restoreFallbackTimer = window.setTimeout(() => {
        isRestoringSession.value = false;
        restoreFallbackTimer = null;
      }, 4000);
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        user.value = await res.json();
        initWebSocket();
      } else {
        localStorage.removeItem('dora_token');
        localStorage.removeItem(ACTIVE_ROOM_KEY);
        isRestoringSession.value = false;
      }
    } catch (e) {
      console.error(e);
      isRestoringSession.value = false;
    }
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('focus', handleWindowFocusOrOnline);
  window.removeEventListener('online', handleWindowFocusOrOnline);
  closeWsCleanly();
});
</script>

