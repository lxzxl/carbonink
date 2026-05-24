import { currentLocale, type Locale, setLocale } from '@renderer/lib/i18n';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';

/**
 * Settings → General. Houses preferences that apply across the whole
 * app (language, future home for theme / density / reduced-motion).
 *
 * Language switcher: paraglide's runtime updates instantly; the React
 * tree re-renders via the `LocaleProvider` in `main.tsx` listening on
 * the `carbonink:locale-changed` custom event. No reload required.
 */

const LANGUAGE_OPTIONS: Array<{ value: Locale; labelKey: () => string }> = [
  { value: 'zh-CN', labelKey: () => m.settings_general_language_zh() },
  { value: 'en', labelKey: () => m.settings_general_language_en() },
];

export function GeneralSection() {
  const active = currentLocale();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-sm font-medium">{m.settings_general_language_label()}</div>
        <p className="text-xs text-muted-foreground">{m.settings_general_language_hint()}</p>
      </div>
      {/* Segmented control — two flat options, the selected one filled.
       * For 2 choices a segmented control reads more decisively than a
       * dropdown and exposes both languages at a glance. If we grow to
       * 3+ locales, switch to a select. */}
      <div className="inline-flex rounded-md border border-border bg-card p-0.5">
        {LANGUAGE_OPTIONS.map((opt) => {
          const isActive = opt.value === active;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLocale(opt.value)}
              aria-pressed={isActive}
              className={cn(
                'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              {opt.labelKey()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
