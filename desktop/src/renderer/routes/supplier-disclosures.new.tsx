import { SupplierPicker } from '@renderer/components/inbound/SupplierPicker';
import { Main } from '@renderer/components/layout/main';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { inboundQuestionnaireApi } from '@renderer/lib/api/inbound-questionnaire';
import { orgApi } from '@renderer/lib/api/organization';
import type { ReportingPeriod } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * `/supplier-disclosures/new` — Cat 1 supplier disclosure wizard.
 *
 * Four steps stacked vertically on one screen (no multi-page flow —
 * the form is short enough to fit). The user picks:
 *  1. A supplier (existing dropdown or create-new inline).
 *  2. A reporting period (defaults to the org's active period).
 *  3. A template (v2.0: only Cat 1 supplier disclosure, locked).
 *  4. Which questions to include (defaults: all checked).
 *
 * Submit calls `inbound-create-draft` IPC; on success the user lands
 * on the new questionnaire's detail page in status='draft' where the
 * "Export blank xlsx" button is available.
 */
export const Route = createFileRoute('/supplier-disclosures/new')({
  component: NewSupplierDisclosureRoute,
});

// Cat 1 v1.0 template positions + metadata, hard-coded to avoid a
// round-trip just for the question list. Kept in sync with the
// canonical definition in `desktop/src/main/services/inbound-templates/cat1.ts`.
const CAT1_QUESTIONS = [
  { position: 'meta.1', label: '供应商法定名称', kind: 'metadata' as const },
  { position: 'meta.2', label: '供应商报告期', kind: 'metadata' as const },
  { position: 'meta.3', label: 'GHG 清单状态', kind: 'metadata' as const },
  { position: 'tier1.1', label: '单位产品碳足迹 (kgCO2e/kg)', kind: 'tier1' as const },
  { position: 'tier2.1', label: 'Scope 1+2 年度排放总量 (kgCO2e)', kind: 'tier2' as const },
  { position: 'tier2.2', label: '分配方法', kind: 'tier2' as const },
  { position: 'tier2.3', label: '归因于我方采购的排放量 (kgCO2e)', kind: 'tier2' as const },
];

function NewSupplierDisclosureRoute(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });
  const orgId = orgQuery.data?.id ?? '';

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId }),
    enabled: orgId !== '',
  });
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const activePeriod = periods.find((p: ReportingPeriod) => p.is_active === 1) ?? periods[0];

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [includedPositions, setIncludedPositions] = useState<Set<string>>(
    new Set(CAT1_QUESTIONS.map((q) => q.position)),
  );

  // Adopt the active period as the default once data arrives.
  if (periodId === null && activePeriod) {
    setPeriodId(activePeriod.id);
  }

  function togglePosition(position: string): void {
    setIncludedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!supplierId) throw new Error('请先选择供应商');
      if (!periodId) throw new Error('请先选择报告期');
      return inboundQuestionnaireApi.createDraft({
        supplier_id: supplierId,
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: Array.from(includedPositions),
      });
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      toast.success(
        `已创建供应商披露草稿（${r.question_count} 题）。点击「导出空白 xlsx」开始流程。`,
      );
      void navigate({ to: '/supplier-disclosures/$id', params: { id: r.questionnaire_id } });
    },
    onError: (err) => {
      toast.error('创建失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const canSubmit =
    supplierId !== null &&
    periodId !== null &&
    includedPositions.size > 0 &&
    !createMutation.isPending;

  return (
    <div className="h-full overflow-auto">
      <Main className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: '/supplier-disclosures' })}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
          <h1 className="text-2xl font-semibold">新建供应商披露 / Supplier Disclosure</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          向上游供应商发送 Scope 3 Cat 1 披露问卷。供应商填写后回传 xlsx，系统自动转换为本企业 Scope
          3 库存数据。
        </p>

        <div className="rounded-md border border-border bg-card p-6 space-y-6">
          {/* Step 1: supplier */}
          <SupplierPicker
            value={supplierId}
            onChange={setSupplierId}
            disabled={createMutation.isPending}
          />

          {/* Step 2: reporting period */}
          <div className="space-y-2">
            <Label htmlFor="period-select">报告期 / Reporting period</Label>
            <select
              id="period-select"
              value={periodId ?? ''}
              onChange={(e) => setPeriodId(e.target.value)}
              disabled={createMutation.isPending || periodsQuery.isLoading}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                {periodsQuery.isLoading ? '加载中...' : '选择报告期'}
              </option>
              {periods.map((p: ReportingPeriod) => (
                <option key={p.id} value={p.id}>
                  {p.year} ({p.granularity}){p.is_active === 1 ? ' · 当前' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Step 3: template (locked in v2.0) */}
          <div className="space-y-2">
            <Label htmlFor="template-select">模板 / Template</Label>
            <select
              id="template-select"
              value="cat1_supplier_disclosure"
              disabled
              className="flex h-9 w-full rounded-md border border-input bg-muted/50 px-3 py-1 text-sm opacity-70 disabled:cursor-not-allowed"
            >
              <option value="cat1_supplier_disclosure">
                Cat 1 Supplier Disclosure (v1.0) — 7 题
              </option>
            </select>
            <p className="text-xs text-muted-foreground">
              v2.0 仅提供 Cat 1 模板。其他类目（Cat 4 运输、Cat 5 废弃物等）将在后续版本加入。
            </p>
          </div>

          {/* Step 4: question subset */}
          <div className="space-y-3">
            <Label>包含的题目 / Included questions</Label>
            <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
              {CAT1_QUESTIONS.map((q) => (
                <label key={q.position} className="flex items-start gap-3 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={includedPositions.has(q.position)}
                    onChange={() => togglePosition(q.position)}
                    disabled={createMutation.isPending}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{q.label}</div>
                    <div className="text-xs text-muted-foreground">
                      <code className="font-mono">{q.position}</code>
                      {q.kind === 'tier1' && ' · Tier 1 (per-unit PCF)'}
                      {q.kind === 'tier2' && ' · Tier 2 (allocated emissions)'}
                      {q.kind === 'metadata' && ' · 必填元数据'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            {includedPositions.size === 0 && (
              <p className="text-xs text-destructive">至少选择一题。</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <Button type="button" onClick={() => createMutation.mutate()} disabled={!canSubmit}>
              {createMutation.isPending ? '创建中...' : '创建草稿'}
            </Button>
            <span className="text-xs text-muted-foreground">
              创建后跳转到详情页，下一步是导出空白 xlsx 邮件发给供应商。
            </span>
          </div>
        </div>
      </Main>
    </div>
  );
}
