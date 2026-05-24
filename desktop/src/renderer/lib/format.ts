/**
 * Shared number formatting (Round 4 redesign #12).
 *
 * Carbonink's data is mostly CO2e measurements with mixed precision.
 * Before this helper, every site rolled its own NumberFormat — leading
 * to:
 *   - dashboard: "122,675" (no decimals)
 *   - report narrative: "14501.820000000002" (12 decimals, no comma)
 *   - audit card: "5,703 kg" (en-US locale)
 *   - questionnaire: ad-hoc toFixed(2)
 *
 * Unified: zh-CN locale + max 1 decimal for CO2e values + 0 decimals
 * for integer-by-nature things. Hover should reveal full precision via
 * `title` attribute where useful.
 */

const CO2E_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
});

const INTEGER_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
});

const PERCENT_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
});

/** Format a CO2e value (kg). `122675.000` → `122,675`. */
export function formatCo2e(n: number | null | undefined): string {
  return CO2E_FORMATTER.format(n ?? 0);
}

/** Format an integer-ish number (counts, IDs). `100` → `100`. */
export function formatInteger(n: number | null | undefined): string {
  return INTEGER_FORMATTER.format(n ?? 0);
}

/**
 * Format a byte count for human display: `1024` → `"1.0 KB"`, `1.5e6` →
 * `"1.4 MB"`. Used by the Settings → Data section for backup sizes,
 * database size, and cache size readouts.
 *
 * Decimal (1024-based) prefixes match what most desktop OS file managers
 * show — Finder labels 1024 bytes as "1 KB" too, so consistency with the
 * user's mental model wins over strict SI (which would say "1 KiB").
 */
export function formatBytes(n: number | null | undefined): string {
  const bytes = n ?? 0;
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / k ** i;
  const decimals = i === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${sizes[i]}`;
}

/**
 * Signed percentage with one decimal. `+5.2` / `-117.7`. Sign included
 * (Intl's `signDisplay: 'exceptZero'` isn't widely cross-locale yet, so
 * we do it manually).
 */
export function formatSignedPercent(n: number): string {
  const formatted = PERCENT_FORMATTER.format(Math.abs(n));
  return n >= 0 ? `+${formatted}` : `-${formatted}`;
}

/** Signed integer with explicit sign. `+710` / `-140`. */
export function formatSignedInteger(n: number): string {
  const formatted = INTEGER_FORMATTER.format(Math.abs(n));
  return n >= 0 ? `+${formatted}` : `-${formatted}`;
}

/**
 * Translate a reporting-period granularity enum into a localized label.
 * The DB stores the snake_case English value (`annual` / `quarterly` /
 * `monthly`) for forward compatibility; the UI should never show the
 * raw key. Falls back to the input on unknown values (defensive).
 */
import * as m from '@renderer/paraglide/messages';

export function granularityLabel(g: string): string {
  switch (g) {
    case 'annual':
      return m.period_granularity_annual();
    case 'quarterly':
      return m.period_granularity_quarterly();
    case 'monthly':
      return m.period_granularity_monthly();
    default:
      return g;
  }
}

/**
 * Translate `boundary_kind` enum (`equity_share` / `financial_control` /
 * `operational_control`) into the localized label. Reuses the existing
 * Settings-page i18n keys so the label is consistent between the
 * Settings form and the report narrative.
 */
export function boundaryKindLabel(b: string): string {
  switch (b) {
    case 'equity_share':
      return m.settings_boundary_equity_share();
    case 'financial_control':
      return m.settings_boundary_financial_control();
    case 'operational_control':
      return m.settings_boundary_operational_control();
    default:
      return b;
  }
}
