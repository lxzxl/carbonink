/**
 * Theme preference — light / dark / system.
 *
 * Storage: `localStorage['carbonink.theme']`. Default: 'system'.
 *
 * `system` resolves dynamically via `prefers-color-scheme`. The runtime
 * listens for OS-level theme changes and re-applies the `dark` class on
 * `<html>` when the user toggles macOS Light/Dark mode, so the
 * application follows in real-time without a manual toggle.
 *
 * Visual mechanism: Tailwind `dark:` variants. We add/remove a `dark`
 * class on `<html>` based on the resolved theme. CSS variables defined
 * in `globals.css` under `.dark { ... }` then take effect.
 */

export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'carbonink.theme';
const THEME_CHANGED_EVENT = 'carbonink:theme-changed';

export function getStoredTheme(): ThemePref {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

/**
 * Resolve a preference to the concrete `light | dark` mode that should
 * be reflected in the DOM right now. `'system'` consults the
 * `prefers-color-scheme` media query.
 */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply the resolved theme to the DOM. Adds/removes the `dark` class
 * on `<html>` so Tailwind's `dark:` variants take effect.
 */
export function applyThemeToDocument(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Persist + apply a new theme preference. Also dispatches a custom event
 * so React `useState` subscribers (the GeneralSection's segmented
 * control) can update without prop-drilling.
 */
export function setTheme(pref: ThemePref): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, pref);
  }
  applyThemeToDocument(resolveTheme(pref));
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: pref }));
}

/**
 * Initialize the theme system at app boot. Applies the stored preference
 * and wires a `prefers-color-scheme` listener so 'system' tracks the OS
 * theme dynamically.
 *
 * Returns the resolved theme so callers can use it for the initial paint
 * if they care.
 */
export function initTheme(): 'light' | 'dark' {
  const pref = getStoredTheme();
  const resolved = resolveTheme(pref);
  applyThemeToDocument(resolved);

  // Subscribe to OS theme changes. Only takes effect when the user's
  // preference is 'system' — for 'light' or 'dark' the user has an
  // explicit override and OS changes shouldn't disturb it.
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
      if (getStoredTheme() === 'system') {
        applyThemeToDocument(resolveTheme('system'));
      }
    });
  }
  return resolved;
}

/**
 * Subscribe-side primitive for React components that want to reflect
 * the current preference (e.g., the active segment in the GeneralSection
 * theme switcher). Returns the cleanup function suitable for useEffect.
 */
export function subscribeToThemeChange(handler: (pref: ThemePref) => void): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<ThemePref>;
    handler(ce.detail);
  };
  window.addEventListener(THEME_CHANGED_EVENT, listener);
  return () => window.removeEventListener(THEME_CHANGED_EVENT, listener);
}
