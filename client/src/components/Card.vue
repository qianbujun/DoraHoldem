<template>
  <div
    class="select-none relative rounded-lg transition-all duration-200 cursor-pointer shrink-0"
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
        <span
          class="font-black tracking-wider text-indigo-400/80"
          :class="size === 'sm' ? 'text-[9px]' : 'text-xs'"
        >DORA</span>
      </div>
    </div>

    <!-- 卡牌正面（纯 HTML + CSS + Unicode 花色字符渲染，严格 overflow-hidden 杜绝角标溢出） -->
    <div
      v-else
      class="w-full h-full rounded-lg overflow-hidden flex flex-col justify-between font-bold relative"
      :class="[
        paddingClasses[size],
        isRed ? 'text-red-600' : 'text-slate-900'
      ]"
    >
      <!-- 左上角标 -->
      <div class="flex flex-col items-center leading-none text-left self-start z-1">
        <span class="font-black leading-none" :class="rankClasses[size]">{{ displayRank }}</span>
        <span class="leading-none mt-0.5" :class="suitClasses[size]">{{ suitSymbol }}</span>
      </div>

      <!-- 中心大花色字符（绝对居中，适度透明度避免遮挡角标） -->
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none select-none" :class="centerClasses[size]">
        <span>{{ suitSymbol }}</span>
      </div>

      <!-- 右下反向角标 -->
      <div class="flex flex-col items-center leading-none text-right self-end rotate-180 z-1">
        <span class="font-black leading-none" :class="rankClasses[size]">{{ displayRank }}</span>
        <span class="leading-none mt-0.5" :class="suitClasses[size]">{{ suitSymbol }}</span>
      </div>
    </div>

    <!-- 宝牌（Dora）高光徽章 -->
    <div
      v-if="isDora && !isBack"
      class="absolute bg-amber-400 text-slate-950 rounded-full font-black shadow z-10 leading-none"
      :class="size === 'sm' ? '-top-1.5 -right-1 text-[8px] px-1 py-0.5' : '-top-2 -right-1 text-[9px] px-1.5 py-0.5'"
    >
      DORA
    </div>

    <!-- 置换明置手牌徽章 -->
    <div
      v-if="isExposed"
      class="absolute bg-cyan-600 text-white rounded shadow tracking-tighter z-10 leading-none"
      :class="size === 'sm' ? '-bottom-1.5 -left-1 text-[8px] px-1 py-0.5' : '-bottom-2 -left-1 text-[9px] px-1.5 py-0.5'"
    >
      明
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

// 严谨标准的扑克宽高比例（约 1 : 1.43），确保在各断点及设备上均有固定容器盒高度
const sizeClasses = {
  sm: 'w-[42px] h-[60px] sm:w-[48px] sm:h-[68px]',
  md: 'w-[56px] h-[80px] sm:w-[64px] sm:h-[92px]',
  lg: 'w-[80px] h-[114px] sm:w-[96px] sm:h-[136px]',
};

const paddingClasses = {
  sm: 'p-1',
  md: 'p-1.5',
  lg: 'p-2',
};

const rankClasses = {
  sm: 'text-[10px] sm:text-xs',
  md: 'text-xs sm:text-sm',
  lg: 'text-sm sm:text-base',
};

const suitClasses = {
  sm: 'text-[9px] sm:text-[10px]',
  md: 'text-[11px] sm:text-xs',
  lg: 'text-xs sm:text-sm',
};

const centerClasses = {
  sm: 'text-base sm:text-lg opacity-40',
  md: 'text-2xl sm:text-3xl opacity-60',
  lg: 'text-3xl sm:text-4xl opacity-75',
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

