import { cn } from '@renderer/lib/utils';
import type { Question } from '@shared/types';

/**
 * Read-only table-of-questions for inbound (supplier disclosure)
 * questionnaires. Each row shows the bilingual question text and a
 * tier badge (Tier 1 / Tier 2 / 元数据) so the user can scan which
 * disclosure pillars the draft covers.
 *
 * When `answersByQuestionId` is supplied (status='received'/'ingested'),
 * each row also shows the supplier's filled-in value. Without it (draft /
 * sent), the table is the bare question list. This is what makes the
 * detail page reflect "the import worked, here's what the supplier said"
 * instead of looking empty after a successful import — the actual
 * accept/reject review still happens on the dedicated ingest page.
 */
export interface InboundQuestionTableProps {
  questions: readonly Question[];
  /** question_id → captured answer (value + optional unit + supplier note). */
  answersByQuestionId?: ReadonlyMap<string, { value: string; unit: string | null; note: string }>;
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

export function InboundQuestionTable({
  questions,
  answersByQuestionId,
}: InboundQuestionTableProps): JSX.Element {
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
              {answersByQuestionId &&
                (() => {
                  const ans = answersByQuestionId.get(q.id);
                  const hasValue = ans && ans.value.trim() !== '';
                  const hasNote = ans && ans.note.trim() !== '';
                  return (
                    <>
                      <p className="text-sm">
                        <span className="text-muted-foreground">供应商填写：</span>
                        {hasValue ? (
                          <span className="font-medium tabular-nums">
                            {ans?.value}
                            {ans?.unit ? ` ${ans.unit}` : ''}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">未填写</span>
                        )}
                      </p>
                      {hasNote && (
                        <p className="text-xs text-muted-foreground">备注：{ans?.note}</p>
                      )}
                    </>
                  );
                })()}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
