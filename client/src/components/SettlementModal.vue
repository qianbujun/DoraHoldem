<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
    <div class="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 flex flex-col gap-4 max-h-[92vh]">
      <!-- 结算头 -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <span class="text-2xl">🏆</span>
          <div>
            <h3 class="text-base sm:text-lg font-black text-amber-400">
              {{ $t('scoring.settlementTitle') }}
            </h3>
            <span class="text-xs text-slate-400">
              {{ $t('endReasons.' + settlement.endReason) }}
            </span>
          </div>
        </div>

        <!-- 基础分计算公式展示 -->
        <div class="bg-amber-500/10 border border-amber-400/40 px-3 py-1.5 rounded-xl text-right">
          <div class="text-[10px] text-amber-300 font-semibold">{{ $t('game.baseScore') }}</div>
          <div class="text-sm font-black text-amber-400 font-mono">
            {{ settlement.baseScore }} pts
          </div>
        </div>
      </div>

      <!-- 基础分拆解提示 -->
      <div v-if="settlement.endReason !== 'lone_survivor'" class="bg-slate-800/60 p-2.5 rounded-xl text-xs text-slate-300 flex items-center justify-between">
        <span>{{ $t('scoring.formula', {
          board: settlement.finalCommunityCards.length,
          orbit: settlement.finalOrbit,
          dora: getWinnerDoraCount(),
          total: settlement.baseScore
        }) }}</span>
      </div>

      <!-- 玩家结果列表 -->
      <div class="flex flex-col gap-3 overflow-y-auto max-h-[50vh] pr-1">
        <div
          v-for="res in settlement.playerResults"
          :key="res.seat"
          class="p-3 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition"
          :class="[
            res.isWinner ? 'bg-amber-500/10 border-amber-400/60' : 'bg-slate-800/40 border-slate-800',
            res.isFolded ? 'opacity-60' : ''
          ]"
        >
          <!-- 玩家信息与底牌 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <span
                class="w-6 h-6 rounded-full flex items-center justify-center font-black text-xs"
                :class="res.isWinner ? 'bg-amber-400 text-slate-950' : 'bg-slate-700 text-slate-300'"
              >
                #{{ res.seat }}
              </span>
              <span class="font-bold text-sm text-slate-100">{{ res.username }}</span>

              <!-- 身份标签 -->
              <span
                class="text-[10px] font-black px-2 py-0.5 rounded-full"
                :class="res.isWinner ? 'bg-amber-400 text-slate-950' : (res.isFolded ? 'bg-slate-700 text-slate-400' : 'bg-rose-500/20 text-rose-300')"
              >
                {{ res.isWinner ? $t('roles.winner') : (res.isFolded ? $t('roles.foldedPlayer') : $t('roles.activeLoser')) }}
              </span>

              <!-- 牌型名称 -->
              <span v-if="res.bestHand" class="text-xs text-amber-300 font-bold">
                {{ $t(res.bestHand.rankNameKey) }}
                <span v-if="res.bestHand.doraCount > 0" class="text-amber-400">
                  (+{{ res.bestHand.doraCount }} 宝牌)
                </span>
              </span>
            </div>

            <!-- 开牌展示 (Showdown Cards: 包含手牌与右侧隔开的公共牌，用到的牌统一上移高亮) -->
            <div v-if="!res.isFolded && res.revealedHoleCards" class="flex flex-wrap items-center gap-3 pt-3 overflow-x-auto pb-1">
              <!-- 左侧：玩家手牌 (Hole Cards) -->
              <div class="flex flex-col gap-1 shrink-0">
                <span class="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                  <span>🎴</span>
                  <span>{{ $t('replay.holeCards') || '手牌' }}</span>
                </span>
                <div class="flex items-center gap-1">
                  <div
                    v-for="(card, i) in res.revealedHoleCards"
                    :key="'rev_hole_' + card + '_' + i"
                  >
                    <Card
                      :card="card"
                      :isDora="card[0] === settlement.legalDoraRank"
                      :selected="isCardInBestHand(card, res.bestHand)"
                      size="sm"
                    />
                  </div>
                </div>
              </div>

              <!-- 居中分割线与加号标识 -->
              <div class="flex flex-col items-center justify-center px-1.5 text-slate-500 font-black self-center shrink-0">
                <span class="text-base leading-none text-amber-400/80">+</span>
                <span class="text-[9px] text-slate-400 tracking-wider">公牌</span>
              </div>

              <!-- 右侧：终局公共牌 (Community Cards)，该玩家用到的公牌同样上移高亮 -->
              <div class="flex flex-col gap-1 shrink-0">
                <span class="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                  <span>🏛️</span>
                  <span>{{ $t('game.communityCards') || '公共牌' }}</span>
                </span>
                <div class="flex items-center gap-1">
                  <div
                    v-for="(cCard, ci) in settlement.finalCommunityCards"
                    :key="'rev_comm_' + cCard + '_' + ci"
                  >
                    <Card
                      :card="cCard"
                      :isDora="cCard[0] === settlement.legalDoraRank"
                      :selected="isCardInBestHand(cCard, res.bestHand)"
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-xs text-slate-500 italic py-1">
              （扣牌离场，底牌不公开）
            </div>
          </div>

          <!-- 分数变化与房间累计分 -->
          <div class="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto border-t sm:border-0 border-slate-800 pt-2 sm:pt-0">
            <span
              class="font-black text-base sm:text-lg font-mono"
              :class="res.scoreChange > 0 ? 'text-amber-400' : (res.scoreChange < 0 ? 'text-rose-400' : 'text-slate-400')"
            >
              {{ res.scoreChange > 0 ? '+' : '' }}{{ res.scoreChange }}
            </span>
            <span class="text-[11px] text-slate-400 font-mono">
              总计: {{ res.cumulativeScore > 0 ? '+' : '' }}{{ res.cumulativeScore }}
            </span>
          </div>
        </div>
      </div>

      <!-- 底部操作按钮 -->
      <div class="pt-3 border-t border-slate-800 flex items-center justify-between">
        <span class="text-xs text-slate-400">
          下局庄家将顺时针轮换至下一顺位
        </span>
        <button
          v-if="!isMatchFinished"
          @click="$emit('start-next-round')"
          class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm transition shadow-lg"
        >
          {{ $t('scoring.nextRoundBtn') }}
        </button>
        <button
          v-else
          @click="$emit('view-match-finished')"
          class="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm transition shadow-lg"
        >
          {{ $t('scoring.matchFinishBtn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Card from './Card.vue';

const props = defineProps<{
  settlement: any;
  isMatchFinished?: boolean;
}>();

defineEmits<{
  (e: 'start-next-round'): void;
  (e: 'view-match-finished'): void;
}>();

function getWinnerDoraCount() {
  const winner = props.settlement.playerResults.find((p: any) => p.isWinner);
  return winner?.doraInBestHand || 0;
}

function isCardInBestHand(card: string, bestHand: any) {
  if (!bestHand || !bestHand.best5Cards) return false;
  return bestHand.best5Cards.includes(card);
}
</script>

