import * as runtime from '@renderer/paraglide/runtime';

export type Locale = 'en' | 'zh-CN';

const STORAGE_KEY = 'carbonink.locale';
const LOCALE_CHANGED_EVENT = 'carbonink:locale-changed';

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

/**
 * Switch the active locale at runtime.
 *
 * Persists the choice to localStorage, updates paraglide's in-memory
 * locale (no reload — see `initLocale`), then dispatches a custom event
 * so the React tree's `LocaleProvider` (mounted in `main.tsx`) can bump
 * a state counter and force a re-render of all `m.foo()` consumers.
 *
 * Without the event + provider plumbing, components would keep showing
 * the old translations because React has no way to know paraglide's
 * runtime state changed.
 */
export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  runtime.setLocale(locale, { reload: false });
  window.dispatchEvent(new CustomEvent(LOCALE_CHANGED_EVENT, { detail: locale }));
}

export function currentLocale(): Locale {
  return runtime.getLocale() as Locale;
}

/**
 * Subscribe-side primitive used by `LocaleProvider`. Returns the
 * unsubscribe function so it can be returned directly from a
 * `useEffect` cleanup.
 */
export function subscribeToLocaleChange(handler: (locale: Locale) => void): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<Locale>;
    handler(ce.detail);
  };
  window.addEventListener(LOCALE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LOCALE_CHANGED_EVENT, listener);
}
