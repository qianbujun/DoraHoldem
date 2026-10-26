import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const savedLocale = localStorage.getItem('dora_preferred_lang') || 'zh-CN';

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export function setLocale(lang: 'zh-CN' | 'en-US') {
  i18n.global.locale.value = lang;
  localStorage.setItem('dora_preferred_lang', lang);
  document.documentElement.lang = lang;
}

