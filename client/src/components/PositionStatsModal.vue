<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
    <div class="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl text-slate-100 flex flex-col gap-4">
      <!-- 弹窗标题 -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <span class="text-xl">📊</span>
          <h3 class="text-base sm:text-lg font-bold text-amber-400">
            {{ username }} - {{ $t('positions.modalTitle') }}
          </h3>
        </div>
        <button
          @click="$emit('close')"
          class="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition"
        >
          ✕
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="py-8 text-center text-slate-400">
        加载中...
      </div>

      <!-- 1~5 号位战绩列表卡片 -->
      <div v-else class="flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
        <div
          v-for="stat in stats"
          :key="stat.seat_position"
          class="bg-slate-800/70 border border-slate-700/60 rounded-xl p-3 flex items-center justify-between gap-3"
        >
          <!-- 位置名称与庄家标记 -->
          <div class="flex items-center gap-2.5">
            <span
              class="w-7 h-7 rounded-full flex items-center justify-center font-black text-xs"
              :class="stat.seat_position === 1 ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-700 text-slate-200'"
            >
              {{ stat.seat_position === 1 ? $t('roles.dealerBadge') : stat.seat_position }}
            </span>
            <div class="flex flex-col">
              <span class="font-bold text-xs sm:text-sm text-slate-200">
                {{ getSeatName(stat.seat_position) }}
              </span>
              <span class="text-[10px] text-slate-400">
                {{ $t('positions.playCount') }}: {{ stat.play_count }}
              </span>
            </div>
          </div>

          <!-- 战绩核心指标 -->
          <div class="flex items-center gap-4 text-right">
            <!-- 胜场与胜率 -->
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-400">{{ $t('positions.winRate') }}</span>
              <span class="font-black text-xs sm:text-sm" :class="stat.win_rate > 0 ? 'text-emerald-400' : 'text-slate-400'">
                {{ (stat.win_rate * 100).toFixed(1) }}%
              </span>
            </div>

            <!-- 胜局均分 -->
            <div class="flex flex-col min-w-[60px]">
              <span class="text-[10px] text-slate-400">{{ $t('positions.avgWinScore') }}</span>
              <span class="font-black text-xs sm:text-sm text-amber-300 font-mono">
                {{ stat.avg_win_score > 0 ? '+' + stat.avg_win_score : stat.avg_win_score }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部关闭按钮 -->
      <div class="pt-2 border-t border-slate-800 flex justify-end">
        <button
          @click="$emit('close')"
          class="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition"
        >
          {{ $t('positions.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  userId: number;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const loading = ref(true);
const username = ref('');
const stats = ref<any[]>([]);

function getSeatName(pos: number) {
  switch (pos) {
    case 1: return t('positions.seat1');
    case 2: return t('positions.seat2');
    case 3: return t('positions.seat3');
    case 4: return t('positions.seat4');
    case 5: return t('positions.seat5');
    default: return `Seat ${pos}`;
  }
}

async function loadStats() {
  try {
    const res = await fetch(`/api/users/${props.userId}/position-stats`);
    if (res.ok) {
      const data = await res.json();
      username.value = data.username;
      stats.value = data.stats;
    }
  } catch (err) {
    console.error('Failed to load user position stats', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadStats();
});
</script>

