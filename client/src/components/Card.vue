<template>
  <div
    class="select-none relative rounded-lg transition-all duration-200 cursor-pointer"
    :class="[
      sizeClasses[size],
      horizontal ? 'rotate-90 origin-center my-2' : '',
      selected ? '-translate-y-2 ring-4 ring-amber-400 shadow-xl' : 'card-shadow',
      interactive ? 'hover:-translate-y-1 hover:card-shadow-hover' : '',
      isDora && !isBack ? 'dora-glow ring-2 ring-yellow-400' : '',
      isBack ? 'bg-indigo-900 text-indigo-300 border-2 border-indigo-700' : 'bg-white border border-slate-200'
    ]"
    @click="$emit('click')"
  >
    <!-- 卡牌背面（纯 CSS 几何编织纹理，零图片资源消耗） -->
    <div
      v-if="isBack"
      class="w-full h-full rounded-md p-1 flex items-center justify-center overflow-hidden"
    >
      <div
        class="w-full h-full rounded border border-indigo-500/40 flex items-center justify-center"
        style="background: repeating-linear-gradient(45deg, #1e1b4b, #1e1b4b 5px, #312e81 5px, #312e81 10px);"
      >
        <span class="text-xs font-bold tracking-wider text-indigo-400/80">DORA</span>
      </div>
    </div>

    <!-- 卡牌正面（纯 HTML + CSS + Unicode 花色字符渲染） -->
    <div
      v-else
      class="w-full h-full p-1.5 flex flex-col justify-between font-bold"
      :class="isRed ? 'text-red-600' : 'text-slate-900'"
    >
      <!-- 左上角标 -->
      <div class="flex flex-col items-center leading-none text-left self-start">
        <span class="text-xs sm:text-sm font-black">{{ displayRank }}</span>
        <span class="text-xs sm:text-base leading-none">{{ suitSymbol }}</span>
      </div>

      <!-- 中心大花色字符 -->
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-85">
        <span class="text-2xl sm:text-3xl md:text-4xl leading-none">{{ suitSymbol }}</span>
      </div>

      <!-- 右下反向角标 -->
      <div class="flex flex-col items-center leading-none text-right self-end rotate-180">
        <span class="text-xs sm:text-sm font-black">{{ displayRank }}</span>
        <span class="text-xs sm:text-base leading-none">{{ suitSymbol }}</span>
      </div>

      <!-- 宝牌（Dora）高光徽章 -->
      <div
        v-if="isDora"
        class="absolute -top-2 -right-1 bg-amber-400 text-slate-950 text-[9px] px-1 py-0.5 rounded-full font-black shadow"
      >
        DORA
      </div>

      <!-- 置换明置手牌徽章 -->
      <div
        v-if="isExposed"
        class="absolute -bottom-2 -left-1 bg-cyan-600 text-white text-[9px] px-1 py-0.5 rounded shadow tracking-tighter"
      >
        明
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    card?: string;
    isBack?: boolean;
    isDora?: boolean;
    isExposed?: boolean;
    selected?: boolean;
    horizontal?: boolean;
    size?: 'sm' | 'md' | 'lg';
    interactive?: boolean;
  }>(),
  {
    card: '?',
    isBack: false,
    isDora: false,
    isExposed: false,
    selected: false,
    horizontal: false,
    size: 'md',
    interactive: false,
  }
);

defineEmits<{
  (e: 'click'): void;
}>();

const sizeClasses = {
  sm: 'w-9 h-13 sm:w-11 sm:h-16 text-xs',
  md: 'w-12 h-18 sm:w-15 sm:h-22 md:w-18 md:h-26',
  lg: 'w-16 h-24 sm:w-20 sm:h-30 md:w-24 md:h-34',
};

const displayRank = computed(() => {
  if (!props.card || props.card.length < 2) return '?';
  const r = props.card[0];
  return r === 'T' ? '10' : r;
});

const suitSymbol = computed(() => {
  if (!props.card || props.card.length < 2) return '';
  const s = props.card[1];
  switch (s) {
    case 's': return '♠';
    case 'h': return '♥';
    case 'c': return '♣';
    case 'd': return '♦';
    default: return '';
  }
});

const isRed = computed(() => {
  if (!props.card || props.card.length < 2) return false;
  const s = props.card[1];
  return s === 'h' || s === 'd';
});
</script>

