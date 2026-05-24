import { currentLocale, type Locale, setLocale } from '@renderer/lib/i18n';
import {
  getStoredTheme,
  setTheme,
  subscribeToThemeChange,
  type ThemePref,
} from '@renderer/lib/theme';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { useEffect, useState } from 'react';

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

const THEME_OPTIONS: Array<{ value: ThemePref; labelKey: () => string }> = [
  { value: 'system', labelKey: () => m.settings_general_theme_system() },
  { value: 'light', labelKey: () => m.settings_general_theme_light() },
  { value: 'dark', labelKey: () => m.settings_general_theme_dark() },
];

export function GeneralSection() {
  const activeLocale = currentLocale();
  // Theme uses local state because `setTheme` mutates the DOM directly
  // and dispatches an event; the React subscription here just keeps the
  // segmented control's `aria-pressed` state in sync.
  const [activeTheme, setActiveTheme] = useState<ThemePref>(getStoredTheme());
  useEffect(() => subscribeToThemeChange((pref) => setActiveTheme(pref)), []);

  return (
    <div className="space-y-8">
      {/* Language */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">{m.settings_general_language_label()}</div>
          <p className="text-xs text-muted-foreground">{m.settings_general_language_hint()}</p>
        </div>
        <SegmentedControl options={LANGUAGE_OPTIONS} active={activeLocale} onChange={setLocale} />
      </div>

      {/* Theme */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">{m.settings_general_theme_label()}</div>
          <p className="text-xs text-muted-foreground">{m.settings_general_theme_hint()}</p>
        </div>
        <SegmentedControl options={THEME_OPTIONS} active={activeTheme} onChange={setTheme} />
      </div>
    </div>
  );
}

/**
 * Generic 2-or-3 option segmented control. Used by both language and
 * theme switchers to keep visual treatment consistent — the design
 * system can evolve in one place.
 */
function SegmentedControl<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<{ value: T; labelKey: () => string }>;
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {options.map((opt) => {
        const isActive = opt.value === active;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
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
  );
}
