import * as runtime from '@renderer/paraglide/runtime';

export type Locale = 'en' | 'zh-CN';

const STORAGE_KEY = 'carbonink.locale';

export function initLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  const navigator = typeof window !== 'undefined' ? window.navigator.language : 'en';
  const locale: Locale =
    stored === 'zh-CN' || stored === 'en' ? stored : navigator.startsWith('zh') ? 'zh-CN' : 'en';
  // `{ reload: false }` is critical. Paraglide's `setLocale` default is
  // `reload: true`, which calls `window.location.reload()` when the new
  // locale differs from `getLocale()`. On first mount we don't have a
  // paraglide-tracked current locale, so the reload fires every paint —
  // and because our STORAGE_KEY ("carbonink.locale") isn't paraglide's
  // internal localStorage key, the reload loops forever in production
  // (where `loadFile` puts the renderer at `file://...` and the
  // navigator.language strategy can't read a cookie either).
  //
  // The fix: just set the locale in-memory. The renderer is freshly
  // mounted; there's nothing painted yet that needs "refreshing".
  runtime.setLocale(locale, { reload: false });
  return locale;
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  // Same reasoning as `initLocale`. A full page reload would also wipe
  // in-flight UI state (open drawers, scroll position) for no benefit
  // beyond what React's normal re-render does.
  runtime.setLocale(locale, { reload: false });
}

export function currentLocale(): Locale {
  return runtime.getLocale() as Locale;
}
