<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
    <div class="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl text-slate-100 flex flex-col gap-4 max-h-[85vh]">
      <!-- 弹窗顶栏 -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <span class="text-xl">📜</span>
          <h3 class="text-base sm:text-lg font-bold text-amber-400">
            {{ isZh ? '《宿命公牌》官方规则说明书' : "Dora Hold'em Official Rulebook" }}
          </h3>
        </div>
        <div class="flex items-center gap-3">
          <!-- 弹窗内支持临时中英切换 -->
          <button
            @click="toggleLang"
            class="text-xs px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold transition"
          >
            {{ isZh ? 'Switch to English' : '切换为中文' }}
          </button>
          <button
            @click="$emit('close')"
            class="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 规则正文 (Markdown 渲染) -->
      <div
        class="prose prose-invert prose-amber max-w-none overflow-y-auto pr-3 text-slate-300 text-xs sm:text-sm leading-relaxed"
        v-html="renderedHtml"
      ></div>

      <!-- 底部关闭按钮 -->
      <div class="pt-3 border-t border-slate-800 flex justify-end">
        <button
          @click="$emit('close')"
          class="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow"
        >
          我已知晓 (Got it)
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { marked } from 'marked';

// 直接通过 Vite ?raw 引入工作区真实中英规则文件
import zhContent from '../../../规则.md?raw';
import enContent from '../../../rules.md?raw';

const { locale } = useI18n();

defineEmits<{
  (e: 'close'): void;
}>();

const currentLang = ref(locale.value);

const isZh = computed(() => currentLang.value === 'zh-CN');

function toggleLang() {
  currentLang.value = currentLang.value === 'zh-CN' ? 'en-US' : 'zh-CN';
}

const renderedHtml = computed(() => {
  const content = isZh.value ? zhContent : enContent;
  return marked.parse(content);
});
</script>

<style scoped>
:deep(h1), :deep(h2), :deep(h3) {
  color: #fbbf24;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  font-weight: 800;
}
:deep(p), :deep(li) {
  margin-bottom: 0.5rem;
}
:deep(strong) {
  color: #fde68a;
}
:deep(hr) {
  border-color: #334155;
  margin: 1rem 0;
}
</style>

