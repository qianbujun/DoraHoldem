<template>
  <div class="w-full max-w-4xl mx-auto bg-slate-900/95 border border-slate-700/80 rounded-2xl p-4 shadow-2xl backdrop-blur-md">
    <!-- 顶部状态提示 -->
    <div class="flex items-center justify-between pb-3 border-b border-slate-800">
      <div class="flex items-center gap-2">
        <span class="inline-block w-3 h-3 rounded-full bg-amber-400 animate-ping"></span>
        <span class="font-bold text-amber-400 text-sm sm:text-base">
          {{ activeModeTitle || $t('actions.selectAction') }}
        </span>
      </div>
      <button
        v-if="currentMode !== 'idle'"
        @click="resetMode"
        class="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition"
      >
        取消选择
      </button>
    </div>

    <!-- 模式 0: 主菜单 5 选 1 按钮 -->
    <div v-if="currentMode === 'idle'" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3 pt-3">
      <!-- 动作 1: 弃牌换牌 -->
      <button
        @click="enterMode('discard')"
        class="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-b from-indigo-900/40 to-indigo-950 border border-indigo-700/60 hover:border-indigo-400 hover:from-indigo-800/50 transition group"
      >
        <span class="text-xl mb-1 group-hover:scale-110 transition">🔄</span>
        <span class="font-bold text-xs sm:text-sm text-indigo-200">{{ $t('actions.discardDraw.title') }}</span>
        <span class="text-[10px] text-slate-400 mt-0.5">弃1或2张摸等量</span>
      </button>

      <!-- 动作 2: 操控公牌 -->
      <button
        @click="enterMode('manipulate')"
        class="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-b from-teal-900/40 to-teal-950 border border-teal-700/60 hover:border-teal-400 hover:from-teal-800/50 transition group"
      >
        <span class="text-xl mb-1 group-hover:scale-110 transition">🎯</span>
        <span class="font-bold text-xs sm:text-sm text-teal-200">{{ $t('actions.manipulateBoard.title') }}</span>
        <span class="text-[10px] text-slate-400 mt-0.5">置换或放逐</span>
      </button>

      <!-- 动作 3: 增加公牌 -->
      <button
        @click="executeExpandBoard"
        class="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-b from-sky-900/40 to-sky-950 border border-sky-700/60 hover:border-sky-400 hover:from-sky-800/50 transition group"
      >
        <span class="text-xl mb-1 group-hover:scale-110 transition">➕</span>
        <span class="font-bold text-xs sm:text-sm text-sky-200">{{ $t('actions.expandBoard.title') }}</span>
        <span class="text-[10px] text-slate-400 mt-0.5">盲翻1张/底分+1</span>
      </button>

      <!-- 动作 4: 弃牌跑路 -->
      <button
        @click="executeFold"
        class="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-b from-rose-950/60 to-rose-950 border border-rose-800/80 hover:border-rose-500 hover:from-rose-900/70 transition group"
      >
        <span class="text-xl mb-1 group-hover:scale-110 transition">🏃</span>
        <span class="font-bold text-xs sm:text-sm text-rose-300">{{ $t('actions.fold.title') }}</span>
        <span class="text-[10px] text-rose-400/80 mt-0.5">支付 {{ currentOrbit }} 筹码离场</span>
      </button>

      <!-- 动作 5: 终结决战 -->
      <button
        @click="executeCallShowdown"
        class="col-span-2 sm:col-span-1 flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-b from-amber-600 to-amber-700 text-slate-950 font-black shadow-lg hover:from-amber-500 hover:to-amber-600 transition group"
      >
        <span class="text-xl mb-1 group-hover:scale-110 transition">⚔️</span>
        <span class="font-black text-xs sm:text-sm">{{ $t('actions.callShowdown.title') }}</span>
        <span class="text-[10px] text-slate-950/80 mt-0.5 font-bold">立刻开牌决胜</span>
      </button>
    </div>

    <!-- 模式 1: 弃牌换牌子面板 -->
    <div v-else-if="currentMode === 'discard'" class="pt-3 flex flex-col gap-3">
      <div class="flex items-center justify-center gap-4 text-xs font-semibold">
        <button
          @click="discardType = 'discard1'"
          class="px-3 py-1.5 rounded-lg border transition"
          :class="discardType === 'discard1' ? 'bg-indigo-600 border-indigo-400 text-white' : 'border-slate-700 text-slate-400'"
        >
          {{ $t('actions.discardDraw.discard1') }}
        </button>
        <button
          @click="discardType = 'discard2'"
          class="px-3 py-1.5 rounded-lg border transition"
          :class="discardType === 'discard2' ? 'bg-indigo-600 border-indigo-400 text-white' : 'border-slate-700 text-slate-400'"
        >
          {{ $t('actions.discardDraw.discard2') }}
        </button>
      </div>

      <!-- 交互提示与确认按钮 -->
      <div class="flex flex-col sm:flex-row items-center justify-between gap-2 bg-slate-800/60 p-3 rounded-xl text-xs">
        <div class="text-slate-300">
          <span v-if="discardType === 'discard1'">
            👉 {{ $t('actions.discardDraw.selectSinglePrompt') }}
            （当前已选: <span class="font-bold text-amber-400">{{ selectedFaceUp || '未选择' }}</span>）
          </span>
          <span v-else>
            👉 明置牌: <span class="font-bold text-amber-400">{{ selectedFaceUp || '请点击选1张' }}</span> ｜
            暗置牌: <span class="font-bold text-indigo-400">{{ selectedFaceDown || '请点击选1张' }}</span>
          </span>
        </div>
        <button
          :disabled="!canSubmitDiscard"
          @click="submitDiscardDraw"
          class="px-4 py-2 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white shadow"
        >
          {{ $t('actions.discardDraw.confirm') }}
        </button>
      </div>
    </div>

    <!-- 模式 2: 操控公牌子面板 (置换 / 放逐) -->
    <div v-else-if="currentMode === 'manipulate'" class="pt-3 flex flex-col gap-3">
      <div class="flex items-center justify-center gap-4 text-xs font-semibold">
        <button
          @click="manipulateType = 'swap'"
          class="px-3 py-1.5 rounded-lg border transition"
          :class="manipulateType === 'swap' ? 'bg-teal-600 border-teal-400 text-white' : 'border-slate-700 text-slate-400'"
        >
          {{ $t('actions.manipulateBoard.swap') }}
        </button>
        <button
          @click="manipulateType = 'banish'"
          class="px-3 py-1.5 rounded-lg border transition"
          :class="manipulateType === 'banish' ? 'bg-teal-600 border-teal-400 text-white' : 'border-slate-700 text-slate-400'"
        >
          {{ $t('actions.manipulateBoard.banish') }}
        </button>
      </div>

      <!-- 置换操作指引 -->
      <div v-if="manipulateType === 'swap'" class="flex flex-col sm:flex-row items-center justify-between gap-2 bg-slate-800/60 p-3 rounded-xl text-xs">
        <div class="text-slate-300">
          <span>换出手牌: <b class="text-amber-400">{{ swapHandCard || '点击你的手牌' }}</b></span>
          <span class="mx-2">⇄</span>
          <span>换入公牌: <b class="text-teal-400">{{ swapBoardCard || '点击中央公牌' }}</b></span>
        </div>
        <button
          :disabled="!swapHandCard || !swapBoardCard"
          @click="submitSwap"
          class="px-4 py-2 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed bg-teal-600 hover:bg-teal-500 text-white shadow"
        >
          {{ $t('actions.manipulateBoard.confirmSwap') }}
        </button>
      </div>

      <!-- 放逐刷新指引 -->
      <div v-else class="flex flex-col sm:flex-row items-center justify-between gap-2 bg-slate-800/60 p-3 rounded-xl text-xs">
        <div class="text-slate-300">
          <span>放逐公牌: <b class="text-rose-400">{{ banishBoardCard || '点击中央公牌选择' }}</b></span>
        </div>
        <button
          :disabled="!banishBoardCard"
          @click="submitBanish"
          class="px-4 py-2 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed bg-rose-600 hover:bg-rose-500 text-white shadow"
        >
          {{ $t('actions.manipulateBoard.confirmBanish') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  currentOrbit: number;
  myHoleCards: string[];
  exposedCards: string[];
  communityCards: string[];
}>();

const emit = defineEmits<{
  (e: 'action-discard-draw', data: { discardFaceUp: string; discardFaceDown?: string }): void;
  (e: 'action-swap', data: { handCard: string; boardCard: string }): void;
  (e: 'action-banish', data: { boardCard: string }): void;
  (e: 'action-expand-board'): void;
  (e: 'action-fold'): void;
  (e: 'action-call-showdown'): void;
}>();

const currentMode = ref<'idle' | 'discard' | 'manipulate'>('idle');
const discardType = ref<'discard1' | 'discard2'>('discard2');
const selectedFaceUp = ref<string>('');
const selectedFaceDown = ref<string>('');

const manipulateType = ref<'swap' | 'banish'>('swap');
const swapHandCard = ref<string>('');
const swapBoardCard = ref<string>('');
const banishBoardCard = ref<string>('');

const activeModeTitle = computed(() => {
  if (currentMode.value === 'discard') return t('actions.discardDraw.title');
  if (currentMode.value === 'manipulate') return t('actions.manipulateBoard.title');
  return '';
});

const canSubmitDiscard = computed(() => {
  if (discardType.value === 'discard1') {
    return Boolean(selectedFaceUp.value);
  }
  return Boolean(selectedFaceUp.value && selectedFaceDown.value && selectedFaceUp.value !== selectedFaceDown.value);
});

function enterMode(mode: 'discard' | 'manipulate') {
  currentMode.value = mode;
  resetSelections();
}

function resetMode() {
  currentMode.value = 'idle';
  resetSelections();
}

function resetSelections() {
  selectedFaceUp.value = '';
  selectedFaceDown.value = '';
  swapHandCard.value = '';
  swapBoardCard.value = '';
  banishBoardCard.value = '';
}

// 供父组件在用户点击自己手牌或公牌时调用
function handleCardSelection(card: string, isFromHand: boolean) {
  if (currentMode.value === 'discard') {
    if (!isFromHand) return;
    if (discardType.value === 'discard1') {
      selectedFaceUp.value = card;
    } else {
      if (!selectedFaceUp.value) {
        selectedFaceUp.value = card;
      } else if (!selectedFaceDown.value && card !== selectedFaceUp.value) {
        selectedFaceDown.value = card;
      } else if (card === selectedFaceUp.value) {
        selectedFaceUp.value = '';
      } else if (card === selectedFaceDown.value) {
        selectedFaceDown.value = '';
      } else {
        selectedFaceUp.value = card;
      }
    }
  } else if (currentMode.value === 'manipulate') {
    if (manipulateType.value === 'swap') {
      if (isFromHand) {
        // 校验：不能换出此前换入的明置手牌
        if (!props.exposedCards.includes(card)) {
          swapHandCard.value = card;
        }
      } else {
        swapBoardCard.value = card;
      }
    } else if (manipulateType.value === 'banish') {
      if (!isFromHand) {
        banishBoardCard.value = card;
      }
    }
  }
}

function submitDiscardDraw() {
  if (discardType.value === 'discard1') {
    emit('action-discard-draw', { discardFaceUp: selectedFaceUp.value });
  } else {
    emit('action-discard-draw', {
      discardFaceUp: selectedFaceUp.value,
      discardFaceDown: selectedFaceDown.value,
    });
  }
  resetMode();
}

function submitSwap() {
  if (swapHandCard.value && swapBoardCard.value) {
    emit('action-swap', {
      handCard: swapHandCard.value,
      boardCard: swapBoardCard.value,
    });
    resetMode();
  }
}

function submitBanish() {
  if (banishBoardCard.value) {
    emit('action-banish', { boardCard: banishBoardCard.value });
    resetMode();
  }
}

function executeExpandBoard() {
  emit('action-expand-board');
  resetMode();
}

function executeFold() {
  emit('action-fold');
  resetMode();
}

function executeCallShowdown() {
  emit('action-call-showdown');
  resetMode();
}

defineExpose({
  handleCardSelection,
  currentMode,
  manipulateType,
});
</script>

