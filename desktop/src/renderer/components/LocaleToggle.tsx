import { currentLocale, type Locale, setLocale } from '@renderer/lib/i18n';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';

/**
 * LocaleToggle — compact "中文 / English" pill for wizard chrome.
 *
 * Why this exists alongside the `GeneralSection` segmented control:
 *   - Onboarding has its own chrome (no sidebar, no settings access until
 *     the wizard completes). Without an inline switcher, a user whose
 *     `navigator.language` mis-detects gets stuck reading whichever locale
 *     `initLocale()` chose with no escape until they finish onboarding.
 *   - The settings switcher is fine but is too wide/loud for the wizard
 *     header. This is the smallest visual treatment that still reads as
 *     "this is a language toggle".
 *
 * Implementation notes:
 *   - Reuses `setLocale()` from `lib/i18n` — same persistence path
 *     (localStorage `carbonink.locale`) + same `carbonink:locale-changed`
 *     event that drives `LocaleProvider`'s re-render in `main.tsx`. The
 *     wizard re-renders along with the rest of the tree because it's
 *     mounted inside the same `LocaleProvider`.
 *   - Labels are `简体中文` / `English` — universal in both locales (we
 *     deliberately don't translate "Chinese" to "中文" because the user
 *     might be stuck in a locale they can't read). Same convention as
 *     macOS / iOS language pickers.
 *   - `aria-pressed` on each button rather than a radiogroup. The control
 *     is two mutually-exclusive states; aria-pressed correctly models
 *     "this is currently the active option" without forcing screen
 *     readers through radiogroup keyboard semantics that don't match
 *     macOS-style pill toggles.
 */

const OPTIONS: Array<{ value: Locale; label: () => string }> = [
  { value: 'zh-CN', label: () => m.settings_general_language_zh() },
  { value: 'en', label: () => m.settings_general_language_en() },
];

export function LocaleToggle({ className }: { className?: string }) {
  const active = currentLocale();
  return (
    // Two buttons with mutually-exclusive `aria-pressed` are
    // self-describing; we deliberately don't wrap in <fieldset> or a
    // `role="group"` div because (a) `<fieldset>` adds visual chrome
    // (legend / default border) we don't want, and (b) GeneralSection's
    // SegmentedControl — which this matches — uses the same plain-div
    // pattern already.
    <div
      className={cn(
        // Slightly smaller padding than the Settings segmented control —
        // wizard chrome should not compete visually with the step title.
        'inline-flex rounded-md border border-border bg-card/60 p-0.5 text-xs',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const isActive = opt.value === active;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLocale(opt.value)}
            aria-pressed={isActive}
            className={cn(
              'rounded-sm px-2.5 py-1 font-medium transition-colors',
              isActive
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )}
          >
            {opt.label()}
          </button>
        );
      })}
    </div>
  );
}
