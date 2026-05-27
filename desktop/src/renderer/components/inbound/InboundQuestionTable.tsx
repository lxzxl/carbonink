import { cn } from '@renderer/lib/utils';
import type { Question } from '@shared/types';

/**
 * Read-only table-of-questions for inbound (supplier disclosure)
 * questionnaires. Each row shows the bilingual question text and a
 * tier badge (Tier 1 / Tier 2 / 元数据) so the user can scan which
 * disclosure pillars the draft covers.
 *
 * This component never shows answer state — inbound answers live on
 * the review-and-confirm page (T10c) and the activity_data table
 * (post-ingest). The detail page's purpose for inbound is to confirm
 * scope + drive the export/import/ingest action bar.
 */
export interface InboundQuestionTableProps {
  questions: readonly Question[];
}

function tierBadge(tier: 1 | 2 | null): { label: string; className: string } {
  if (tier === 1) {
    return {
      label: 'Tier 1',
      className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
  }
  if (tier === 2) {
    return {
      label: 'Tier 2',
      className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    };
  }
  return {
    label: '元数据',
    className: 'bg-muted text-muted-foreground border-border',
  };
}

export function InboundQuestionTable({ questions }: InboundQuestionTableProps): JSX.Element {
  if (questions.length === 0) {
    return <p className="text-muted-foreground italic">尚未配置题目。请回到「新建」重选模板。</p>;
  }

  // Sort by tier (null→1→2) then position so the table reads
  // metadata-first, then increasing tier.
  const sorted = [...questions].sort((a, b) => {
    const ta = a.tier === null ? -1 : a.tier;
    const tb = b.tier === null ? -1 : b.tier;
    if (ta !== tb) return ta - tb;
    return (a.position ?? '').localeCompare(b.position ?? '');
  });

  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {sorted.map((q) => {
        const badge = tierBadge((q.tier as 1 | 2 | null) ?? null);
        return (
          <li key={q.id} className="flex items-start gap-3 px-4 py-3">
            <span
              className={cn(
                'mt-0.5 inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium',
                badge.className,
              )}
            >
              {badge.label}
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-sm leading-snug">{q.raw_text}</p>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">{q.position}</code>
                {q.expected_unit && (
                  <>
                    {' · '}
                    {q.expected_unit}
                  </>
                )}
                {q.required === 1 && <span className="ml-2 text-destructive">*必填</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
