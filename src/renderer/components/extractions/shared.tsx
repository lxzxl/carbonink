import * as m from '@renderer/paraglide/messages';

/**
 * Generic dl-row renderer used by every per-stage Fields component.
 * Renders an em-dash for empty/null/undefined values so the layout
 * stays stable.
 */
export function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{display}</dd>
    </>
  );
}

export const CONFIDENCE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', () => string> = {
  high: m.documents_review_confidence_high,
  medium: m.documents_review_confidence_medium,
  low: m.documents_review_confidence_low,
};
