import * as runtime from '@renderer/paraglide/runtime';

export type Locale = 'en' | 'zh-CN';

const STORAGE_KEY = 'carbonbook.locale';

export function initLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  const navigator = typeof window !== 'undefined' ? window.navigator.language : 'en';
  const locale: Locale =
    stored === 'zh-CN' || stored === 'en' ? stored : navigator.startsWith('zh') ? 'zh-CN' : 'en';
  runtime.setLocale(locale);
  return locale;
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  runtime.setLocale(locale);
}

export function currentLocale(): Locale {
  return runtime.getLocale() as Locale;
}
