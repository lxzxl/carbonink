import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { inboundQuestionnaireApi } from '@renderer/lib/api/inbound-questionnaire';
import { cn } from '@renderer/lib/utils';
import type { ImportPreview, ImportPreviewAnswer, Tier } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AlertCircle, AlertTriangle, ArrowLeft, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/**
 * `/supplier-disclosures/$id/ingest` — review-and-confirm page for an
 * already-imported inbound questionnaire.
 *
 * Renders three columns per row:
 *   · question text (with tier badge)
 *   · supplier-filled value (raw + parsed; blank highlighted)
 *   · proposed activity (if Tier 2 will produce one; null for Tier 1)
 *
 * Per-row checkboxes default to accepted; uncheck to exclude a row from
 * ingest. Tier 1 path additionally surfaces an inline "采购数量 (kg)"
 * input that must be filled before the bottom Confirm button activates.
 *
 * On confirm:
 *   · Tier 2 path: amount = supplier's attributed kgCO2e
 *   · Tier 1 path: amount = supplier PCF × user-entered quantity
 *
 * Both write a single activity_data row + sentinel pinned EF + audit
 * event, then bounce the user back to the detail page (now
 * status='ingested').
 */
export const Route = createFileRoute('/supplier-disclosures/$id/ingest')({
  component: IngestReviewRoute,
});

function IngestReviewRoute(): JSX.Element {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const previewQuery = useQuery({
    queryKey: ['questionnaire:inbound-get-preview', id],
    queryFn: () => inboundQuestionnaireApi.getPreview({ questionnaire_id: id }),
  });

  if (previewQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载预览中…
      </div>
    );
  }
  if (previewQuery.isError) {
    return (
      <div className="flex h-full flex-col items-start gap-4 p-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ to: '/supplier-disclosures/$id', params: { id } })}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回详情
        </Button>
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">加载预览失败</p>
            <p className="mt-1">
              {previewQuery.error instanceof Error
                ? previewQuery.error.message
                : String(previewQuery.error)}
            </p>
            <p className="mt-2 text-xs">
              如果回收文件丢失，请回到详情页点击「重新导出」并请供应商重新填写。
            </p>
          </div>
        </div>
      </div>
    );
  }
  const preview = previewQuery.data;
  if (!preview) return <div className="p-6 text-sm text-muted-foreground">没有数据。</div>;

  return (
    <IngestReviewBody
      preview={preview}
      onIngested={() => {
        void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
        void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
        void queryClient.invalidateQueries({ queryKey: ['activity:list-by-period'] });
        void navigate({ to: '/supplier-disclosures/$id', params: { id } });
      }}
    />
  );
}

function IngestReviewBody({
  preview,
  onIngested,
}: {
  preview: ImportPreview;
  onIngested: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const availableTiers = preview.ingestion_plan.available_tiers;

  // Selected tier — defaults to the auto pick (GHG Protocol preference:
  // Tier 1 over Tier 2). When the supplier supplied BOTH, `availableTiers`
  // has two entries and the user can switch via the selector below.
  const [selectedTier, setSelectedTier] = useState<Tier | null>(
    preview.ingestion_plan.tier_selected,
  );

  // Acceptance state: keyed by question_id. Default all non-blank rows
  // accepted; blank rows can't contribute anything so they start
  // unchecked.
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(preview.answers.filter((a) => !a.is_blank).map((a) => a.question_id)),
  );
  const [tier1Qty, setTier1Qty] = useState<string>(''); // kg, free-text so we can validate

  // Re-key acceptance if preview changes shape under us (rare —
  // happens if the user re-imports without navigating away first).
  // We only care about the questionnaire identity; the dep is encoded
  // through `preview.answers` (which re-references on a new preview).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on questionnaire id intentionally
  useEffect(() => {
    setAccepted(new Set(preview.answers.filter((a) => !a.is_blank).map((a) => a.question_id)));
    setSelectedTier(preview.ingestion_plan.tier_selected);
  }, [preview.questionnaire_id]);

  function toggleAccepted(qid: string): void {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }

  const ingestMutation = useMutation({
    mutationFn: () => {
      const qty = Number.parseFloat(tier1Qty);
      const args: Parameters<typeof inboundQuestionnaireApi.ingest>[0] = {
        questionnaire_id: preview.questionnaire_id,
        accepted_question_ids: Array.from(accepted),
      };
      // Pass the user's tier pick so the service honors it (instead of
      // its default Tier-1-first preference).
      if (selectedTier !== null) {
        args.tier_override = selectedTier;
      }
      if (selectedTier === 1 && Number.isFinite(qty) && qty > 0) {
        args.tier1_purchased_quantity = qty;
      }
      return inboundQuestionnaireApi.ingest(args);
    },
    onSuccess: (r) => {
      if (r.activity_data_ids.length === 0) {
        toast.warning('未生成活动行', {
          description: '所选的答案不足以构成 Tier 1 或 Tier 2 路径。请检查所选项。',
        });
        return;
      }
      toast.success(`已入库 1 条活动数据 (${r.activity_data_ids[0]?.slice(0, 8)}...)`);
      onIngested();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // Confirm-button gating logic — keyed off the *selected* tier now.
  const needsTier1Qty = selectedTier === 1;
  const tier1QtyValid =
    Number.isFinite(Number.parseFloat(tier1Qty)) && Number.parseFloat(tier1Qty) > 0;
  const canConfirm =
    accepted.size > 0 && !ingestMutation.isPending && (!needsTier1Qty || tier1QtyValid);

  // Live total preview — recomputed from the *selected* tier (the
  // server-side ingestion_plan.total_co2e_kg was computed under the auto
  // tier and goes stale the moment the user switches).
  const tier1Pcf = preview.answers.find((a) => a.position === 'tier1.1')?.parsed_value;
  const tier2Co2e = preview.answers.find((a) => a.position === 'tier2.3')?.parsed_value;
  const liveTotalCo2eKg: number | null =
    selectedTier === 1
      ? typeof tier1Pcf === 'number' && tier1QtyValid
        ? tier1Pcf * Number.parseFloat(tier1Qty)
        : null
      : selectedTier === 2
        ? typeof tier2Co2e === 'number'
          ? tier2Co2e
          : null
        : null;

  // Explain WHY the confirm button is disabled — a silently-disabled
  // button reads as "nothing happens when I click". Tier 1 (the GHG
  // Protocol-preferred path, which wins whenever the supplier filled a
  // per-unit PCF) needs a purchased quantity before we can compute a
  // total, so that's the most common gate.
  const disabledReason: string =
    selectedTier === null
      ? '供应商未提供足够数据（需要 Tier 1 单位碳足迹，或 Tier 2 三项齐全）'
      : accepted.size === 0
        ? '请至少勾选一项答案'
        : needsTier1Qty && !tier1QtyValid
          ? '请先在上方填写「本期采购数量 (kg)」'
          : '';

  // Group answers for display: by tier (null first, then 1, then 2).
  const grouped = useMemo(() => groupByTier(preview.answers), [preview.answers]);

  // Tier-1 row(s) — we need to surface the quantity input next to them.
  const tier1Positions = preview.answers.filter((a) => a.tier === 1).map((a) => a.position);

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="shrink-0 space-y-3 px-6 pt-6 pb-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigate({
                to: '/supplier-disclosures/$id',
                params: { id: preview.questionnaire_id },
              })
            }
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回详情
          </Button>
          <h1 className="text-2xl font-semibold">审核并入库</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          供应商：<span className="font-medium text-foreground">{preview.supplier_name}</span>
          {' · '}
          路径：
          <span className="font-medium text-foreground">
            {selectedTier === 1
              ? 'Tier 1 (per-unit PCF)'
              : selectedTier === 2
                ? 'Tier 2 (allocated emissions)'
                : '无足够数据'}
          </span>
        </p>

        {/* Tier selector — only when the supplier supplied BOTH tiers. */}
        {availableTiers.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              入库口径
              <span className="ml-1.5">
                供应商两种口径都填了，默认按 GHG Protocol 优先 Tier 1，可切换。
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <TierCard
                tierLabel="Tier 1"
                title="单位产品碳足迹"
                outcome={
                  typeof tier1Pcf === 'number'
                    ? `${tier1Pcf.toLocaleString()} kgCO2e/kg × 采购数量`
                    : '需供应商 PCF'
                }
                active={selectedTier === 1}
                onClick={() => setSelectedTier(1)}
              />
              <TierCard
                tierLabel="Tier 2"
                title="分配排放"
                outcome={
                  typeof tier2Co2e === 'number'
                    ? `直接采用 ${tier2Co2e.toLocaleString()} kgCO2e`
                    : '需归因排放量'
                }
                active={selectedTier === 2}
                onClick={() => setSelectedTier(2)}
              />
            </div>
          </div>
        )}

        {preview.warnings.length > 0 && <WarningBanner warnings={preview.warnings} />}
      </div>

      {/* Scrolling table */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-3 space-y-4">
        {grouped.map(({ tier, rows }) => (
          <section key={String(tier ?? 'meta')} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{groupHeading(tier)}</h2>
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {rows.map((a) => (
                <AnswerRow
                  key={a.question_id}
                  answer={a}
                  accepted={accepted.has(a.question_id)}
                  onToggle={() => toggleAccepted(a.question_id)}
                />
              ))}
            </ul>
            {/* Surface the Tier 1 quantity input right next to the tier1 group. */}
            {tier === 1 && tier1Positions.length > 0 && selectedTier === 1 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <Label htmlFor="tier1-qty" className="text-amber-800 dark:text-amber-300">
                  本期采购数量 / Purchased quantity (kg)
                  <span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="tier1-qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={tier1Qty}
                  onChange={(e) => setTier1Qty(e.target.value)}
                  placeholder="例如：10000"
                  className="max-w-xs"
                />
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                  Tier 1 路径下，活动数据排放量 = 供应商单位 PCF × 您本期向其采购的总重量。
                </p>
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Sticky bottom — confirm action bar */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
        <div className="text-sm text-muted-foreground">
          预计入库：
          <span className="ml-1 font-medium text-foreground">
            {selectedTier === null ? 0 : 1} 条活动
          </span>
          {liveTotalCo2eKg !== null && (
            <>
              {' · '}
              <span className="font-medium text-foreground">
                {Math.round(liveTotalCo2eKg).toLocaleString()} kgCO2e
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {disabledReason !== '' && (
            <span className="text-xs text-amber-600 dark:text-amber-400">{disabledReason}</span>
          )}
          <Button type="button" onClick={() => ingestMutation.mutate()} disabled={!canConfirm}>
            <Check className="mr-1.5 h-4 w-4" />
            {ingestMutation.isPending ? '入库中...' : '确认并入库'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AnswerRow({
  answer,
  accepted,
  onToggle,
}: {
  answer: ImportPreviewAnswer;
  accepted: boolean;
  onToggle: () => void;
}): JSX.Element {
  const badge = tierBadge(answer.tier);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={accepted}
        onChange={onToggle}
        disabled={answer.is_blank}
        className="mt-1 h-4 w-4 rounded border-input shrink-0"
        aria-label={`接受 ${answer.position}`}
      />
      <span
        className={cn(
          'mt-0.5 inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium',
          badge.className,
        )}
      >
        {badge.label}
      </span>
      <div className="flex-1 grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <code className="font-mono text-xs text-muted-foreground">{answer.position}</code>
          <p className="text-sm">
            {answer.is_blank ? (
              <span className="italic text-muted-foreground">未填写</span>
            ) : typeof answer.parsed_value === 'number' ? (
              <span className="font-medium tabular-nums">
                {answer.parsed_value.toLocaleString()}
              </span>
            ) : (
              <span className="font-medium">{String(answer.parsed_value ?? '')}</span>
            )}
          </p>
          {answer.raw_value !== '' && answer.raw_value !== String(answer.parsed_value) && (
            <p className="text-xs text-muted-foreground">原始: {answer.raw_value}</p>
          )}
          {answer.note.trim() !== '' && (
            <p className="text-xs text-muted-foreground">备注: {answer.note}</p>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {answer.proposed_activity ? (
            <div>
              <div className="font-medium text-foreground">将创建活动行</div>
              <div>
                {answer.proposed_activity.amount.toLocaleString()} {answer.proposed_activity.unit}
              </div>
              <div>CO2e = {answer.proposed_activity.co2e_kg.toLocaleString()} kg</div>
            </div>
          ) : (
            <span className="italic">不产生活动行</span>
          )}
        </div>
      </div>
    </li>
  );
}

function WarningBanner({ warnings }: { warnings: ImportPreview['warnings'] }): JSX.Element {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 space-y-1">
          <p className="font-medium">{warnings.length} 条警告</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            {warnings.map((w) => (
              <li key={`${w.kind}:${w.question_id ?? 'global'}:${w.detail}`}>
                <span className="font-mono">[{w.kind}]</span> {w.detail}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TierCard({
  tierLabel,
  title,
  outcome,
  active,
  onClick,
}: {
  tierLabel: string;
  title: string;
  outcome: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition-colors',
        active
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border bg-card hover:bg-muted/40',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border',
            active ? 'border-primary' : 'border-muted-foreground/40',
          )}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
        </span>
        <span className="text-xs font-medium">
          {tierLabel} · {title}
        </span>
      </span>
      <span className="pl-5 text-xs text-muted-foreground tabular-nums">{outcome}</span>
    </button>
  );
}

function tierBadge(tier: Tier | null): { label: string; className: string } {
  if (tier === 1) {
    return {
      label: 'T1',
      className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
  }
  if (tier === 2) {
    return {
      label: 'T2',
      className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    };
  }
  return {
    label: 'M',
    className: 'bg-muted text-muted-foreground border-border',
  };
}

function groupHeading(tier: Tier | null): string {
  if (tier === 1) return 'Tier 1 — 单位产品碳足迹';
  if (tier === 2) return 'Tier 2 — 分配排放';
  return '元数据 / Metadata';
}

function groupByTier(
  answers: readonly ImportPreviewAnswer[],
): Array<{ tier: Tier | null; rows: ImportPreviewAnswer[] }> {
  const groups: Array<{ tier: Tier | null; rows: ImportPreviewAnswer[] }> = [
    { tier: null, rows: [] },
    { tier: 1, rows: [] },
    { tier: 2, rows: [] },
  ];
  for (const a of answers) {
    const g = groups.find((x) => x.tier === a.tier);
    if (g) g.rows.push(a);
  }
  return groups.filter((g) => g.rows.length > 0);
}
