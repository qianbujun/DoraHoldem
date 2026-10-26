<template>
  <div
    class="flex flex-col items-center justify-between p-3 rounded-2xl transition-all duration-300 relative"
    :class="[
      isCurrentTurn ? 'ring-2 ring-amber-400 bg-amber-500/10 shadow-lg' : 'bg-slate-900/60 border border-slate-800',
      isMe ? 'border-emerald-500/60' : '',
      isFolded ? 'opacity-50 grayscale' : ''
    ]"
  >
    <!-- 玩家信息头（点击可弹出 1~5 号位战绩卡片） -->
    <div
      class="flex items-center gap-2 mb-2 cursor-pointer group hover:bg-slate-800/80 px-2 py-1 rounded-full transition"
      @click="$emit('view-stats', userId)"
      :title="$t('positions.modalTitle')"
    >
      <!-- 庄家徽章 -->
      <span
        v-if="isDealer"
        class="w-5 h-5 rounded-full bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shadow"
      >
        {{ $t('roles.dealerBadge') }}
      </span>

      <!-- 座位标识 -->
      <span class="text-xs font-semibold text-slate-400">#{{ seat }}</span>

      <!-- 昵称 -->
      <span class="font-bold text-sm text-slate-100 group-hover:text-amber-400 transition flex items-center gap-1">
        <span>{{ username }}</span>
        <span v-if="userId < 0" class="text-[9px] px-1 py-0.2 rounded bg-purple-600/40 text-purple-300 font-bold border border-purple-500/40">🤖 AI</span>
        <span v-if="isMe" class="text-xs text-emerald-400 font-normal">({{ $t('lobby.username') }})</span>
      </span>

      <!-- 累计得分 (负分续行展示) -->
      <span
        class="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
        :class="chipScore >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'"
      >
        {{ chipScore > 0 ? '+' : '' }}{{ chipScore }}
      </span>

      <!-- 查看战绩图标小提示 -->
      <span class="text-[10px] text-slate-400 group-hover:text-amber-300 hidden sm:inline">📊</span>
    </div>

    <!-- 跑路状态提示 -->
    <div
      v-if="isFolded"
      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-rose-600/90 text-white font-black text-xs px-3 py-1 rounded-full shadow-lg z-20 border border-rose-300"
    >
      {{ $t('roles.foldedPlayer') }} (第{{ foldOrbit }}巡)
    </div>

    <!-- 手牌展示区 -->
    <div class="flex items-center justify-center gap-1 sm:gap-2 my-1 min-h-[70px]">
      <!-- 1. 如果是自己：展示自己的暗置底牌（可交互选中） -->
      <template v-if="isMe && holeCards">
        <div
          v-for="card in unexposedHoleCards"
          :key="card"
          class="transition-transform"
        >
          <Card
            :card="card"
            :isDora="isCardDora(card)"
            :selected="selectedCards.includes(card)"
            :interactive="interactive"
            size="md"
            @click="$emit('toggle-select-card', card)"
          />
        </div>
      </template>

      <!-- 2. 如果是其他玩家：仅显示暗牌背面（防作弊，完全不泄露牌面数据） -->
      <template v-else-if="!isFolded">
        <div
          v-for="i in Math.max(0, cardCount - exposedCards.length)"
          :key="i"
        >
          <Card isBack size="sm" />
        </div>
      </template>

      <!-- 3. 置换得来的明置手牌（全场可见，竖置展示） -->
      <template v-if="exposedCards && exposedCards.length > 0">
        <div
          v-for="card in exposedCards"
          :key="'exp_' + card"
        >
          <Card
            :card="card"
            :isDora="isCardDora(card)"
            isExposed
            :selected="isMe && selectedCards.includes(card)"
            :interactive="isMe && interactive"
            :size="isMe ? 'md' : 'sm'"
            @click="isMe && $emit('toggle-select-card', card)"
          />
        </div>
      </template>
    </div>

    <!-- 面前展示区：明置弃牌（正面朝上【横置错位叠放】） -->
    <div v-if="faceUpDiscards && faceUpDiscards.length > 0" class="mt-2 w-full pt-1 border-t border-slate-800">
      <div class="text-[10px] text-slate-400 text-left mb-1 flex items-center gap-1">
        <span>明置弃牌:</span>
      </div>
      <div class="flex -space-x-4 sm:-space-x-5 overflow-x-auto py-1">
        <div
          v-for="(card, idx) in faceUpDiscards"
          :key="'dis_' + card + '_' + idx"
          class="shrink-0"
        >
          <!-- 横置展示 -->
          <Card :card="card" :isDora="isCardDora(card)" horizontal size="sm" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Card from './Card.vue';

const props = withDefaults(
  defineProps<{
    seat: number;
    userId: number;
    username: string;
    isDealer?: boolean;
    isCurrentTurn?: boolean;
    isMe?: boolean;
    isFolded?: boolean;
    foldOrbit?: number;
    chipScore?: number;
    cardCount?: number;
    holeCards?: string[];
    exposedCards?: string[];
    faceUpDiscards?: string[];
    selectedCards?: string[];
    legalDoraRank?: string;
    interactive?: boolean;
  }>(),
  {
    isDealer: false,
    isCurrentTurn: false,
    isMe: false,
    isFolded: false,
    chipScore: 0,
    cardCount: 5,
    holeCards: () => [],
    exposedCards: () => [],
    faceUpDiscards: () => [],
    selectedCards: () => [],
    legalDoraRank: '7',
    interactive: false,
  }
);

defineEmits<{
  (e: 'view-stats', userId: number): void;
  (e: 'toggle-select-card', card: string): void;
}>();

const unexposedHoleCards = computed(() => {
  return props.holeCards.filter(c => !props.exposedCards.includes(c));
});

function isCardDora(card: string) {
  return card[0] === props.legalDoraRank;
}
</script>

