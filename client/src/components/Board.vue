<template>
  <div class="relative w-full max-w-4xl mx-auto rounded-3xl felt-table felt-border p-4 sm:p-6 text-white min-h-[260px] sm:min-h-[320px] flex flex-col justify-between">
    <!-- 顶部状态栏：巡目、法定宝牌、底池 -->
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm font-semibold border-b border-emerald-900/50 pb-3">
      <!-- 巡目显示与筹码堆 -->
      <div class="flex items-center gap-2 bg-slate-900/60 backdrop-blur px-3 py-1.5 rounded-full border border-emerald-500/30">
        <div class="flex -space-x-1.5">
          <div
            v-for="i in Math.min(orbit, 6)"
            :key="i"
            class="w-4 h-4 rounded-full bg-amber-500 border border-amber-300 chip-glow shadow"
          ></div>
        </div>
        <span class="text-amber-300 font-bold tracking-wide">
          {{ $t('game.orbitCount', { count: orbit }) }}
        </span>
      </div>

      <!-- 法定宝牌标识 -->
      <div class="flex items-center gap-2 bg-amber-500/10 border border-amber-400/50 px-3 py-1.5 rounded-full">
        <span class="text-amber-400 font-bold">★ {{ $t('game.legalDoraRank') }}:</span>
        <span class="bg-amber-400 text-slate-950 px-2 py-0.5 rounded font-black text-sm">
          {{ legalDoraRank === 'T' ? '10' : legalDoraRank }}
        </span>
        <span class="text-xs text-amber-200/70 hidden sm:inline">（全场所有的 {{ legalDoraRank === 'T' ? '10' : legalDoraRank }} 均为宝牌）</span>
      </div>

      <!-- 桌面底池（含跑路费） -->
      <div class="flex items-center gap-2 bg-slate-900/60 backdrop-blur px-3 py-1.5 rounded-full border border-amber-500/40">
        <span class="text-slate-300">{{ $t('game.pot') }}:</span>
        <span class="text-amber-400 font-black text-base">{{ pot }}</span>
        <span class="text-xs text-amber-400/80">pts</span>
      </div>
    </div>

    <!-- 中部：公牌区与摸牌/废牌堆 -->
    <div class="my-auto py-4 flex flex-col md:flex-row items-center justify-between gap-4">
      <!-- 摸牌堆 (Draw Pile) -->
      <div class="flex items-center gap-2 order-2 md:order-1">
        <div class="relative">
          <!-- 叠放阴影效果 -->
          <div class="absolute -top-1 -left-1 w-12 h-18 sm:w-15 sm:h-22 bg-indigo-950 rounded-lg border border-indigo-700/50"></div>
          <Card isBack size="md" />
        </div>
        <div class="flex flex-col text-left">
          <span class="text-xs text-slate-300">{{ $t('game.drawPile') }}</span>
          <span class="text-lg font-black text-indigo-300">{{ drawPileCount }}</span>
          <span v-if="drawPileCount < 2" class="text-[10px] text-red-400 font-bold animate-pulse">
            即将摸空!
          </span>
        </div>
      </div>

      <!-- 公牌展示区 (Community Cards) -->
      <div class="flex flex-wrap items-center justify-center gap-2 sm:gap-3 order-1 md:order-2 z-10">
        <div
          v-for="(card, index) in communityCards"
          :key="card + '_' + index"
          class="transition-transform"
        >
          <Card
            :card="card"
            :isDora="isCardDora(card)"
            :selected="selectedCard === card"
            :interactive="isSelectable"
            size="md"
            @click="onCardClick(card)"
          />
        </div>
      </div>

      <!-- 公共废牌堆 (Discard Pile) -->
      <div class="flex items-center gap-2 order-3">
        <div class="flex flex-col text-right">
          <span class="text-xs text-slate-300">{{ $t('game.discardPile') }}</span>
          <span class="text-lg font-black text-slate-400">{{ discardPileCount }}</span>
        </div>
        <div class="w-12 h-18 sm:w-15 sm:h-22 rounded-lg border-2 border-dashed border-slate-600/60 bg-slate-900/40 flex items-center justify-center text-slate-500 font-bold text-xs">
          废牌
        </div>
      </div>
    </div>

    <!-- 底部辅助信息：公牌数与当前预估基础分 -->
    <div class="flex items-center justify-between text-xs text-emerald-200/80 border-t border-emerald-900/50 pt-2">
      <div>
        <span>{{ $t('game.communityCards') }}: </span>
        <span class="font-bold text-white">{{ communityCards.length }}</span> 张
      </div>
      <div>
        <span>{{ $t('game.baseScore') }} (公牌{{ communityCards.length }} + 巡目{{ orbit }}): </span>
        <span class="font-black text-amber-300 text-sm">
          {{ communityCards.length + orbit }}
        </span>
        <span class="text-[11px] text-amber-200/60"> + 胜者成牌宝牌</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Card from './Card.vue';

const props = withDefaults(
  defineProps<{
    orbit: number;
    legalDoraRank: string;
    pot: number;
    communityCards: string[];
    drawPileCount: number;
    discardPileCount: number;
    selectedCard?: string;
    isSelectable?: boolean;
  }>(),
  {
    orbit: 1,
    legalDoraRank: '7',
    pot: 0,
    communityCards: () => [],
    drawPileCount: 31,
    discardPileCount: 0,
    selectedCard: undefined,
    isSelectable: false,
  }
);

const emit = defineEmits<{
  (e: 'select-card', card: string): void;
}>();

function isCardDora(card: string) {
  return card[0] === props.legalDoraRank;
}

function onCardClick(card: string) {
  if (props.isSelectable) {
    emit('select-card', card);
  }
}
</script>

