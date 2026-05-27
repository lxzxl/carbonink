import { AnswerReviewCard } from '@renderer/components/AnswerReviewCard';
import { InboundQuestionTable } from '@renderer/components/inbound/InboundQuestionTable';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { activityApi } from '@renderer/lib/api/activity-data';
import { answerApi } from '@renderer/lib/api/answer';
import { inboundQuestionnaireApi } from '@renderer/lib/api/inbound-questionnaire';
import { orgApi } from '@renderer/lib/api/organization';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import type { Answer, Question, Questionnaire } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Download, Upload } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/questionnaires/$id')({
  component: QuestionnaireDetailRoute,
});

function QuestionnaireDetailRoute() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['questionnaire:get-by-id', id],
    queryFn: () => questionnaireApi.getById({ id }),
  });

  const answersQuery = useQuery({
    queryKey: ['answer:list-by-questionnaire', id],
    queryFn: () => answerApi.listByQuestionnaire(id),
    enabled: !!q.data,
  });

  const generateAll = useMutation({
    mutationFn: () => answerApi.generateAllUnanswered(id),
    onSuccess: (results) => {
      if (results.length === 0) {
        toast.success(m.answer_generate_all_empty());
        return;
      }
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      toast.success(m.answer_generate_all_done({ ok, failed }));
      void queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const exportToExcel = useMutation({
    mutationFn: () => answerApi.exportToXlsx({ questionnaire_id: id }),
    onSuccess: (result) => {
      if (result.canceled) return;
      toast.success(m.answer_export_done({ written: result.written, drafts: result.drafts }));
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => questionnaireApi.finalize({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      toast.success(m.questionnaires_finalize_button());
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (q.isLoading) return <p className="text-muted-foreground">{m.loading()}</p>;
  if (!q.data) {
    return (
      <div className="space-y-4">
        <Link to="/questionnaires" className="text-sm text-primary hover:underline">
          {m.questionnaires_detail_back()}
        </Link>
        <p className="text-destructive">{m.questionnaires_detail_not_found()}</p>
      </div>
    );
  }
  const { questionnaire, customer, document, questions } = q.data;

  const byQ = new Map<string, Answer>((answersQuery.data ?? []).map((a) => [a.question_id, a]));

  // Direction branch — inbound and outbound diverge on action bar, body
  // content, and state-machine wiring. Keeping them as two top-level
  // components is more honest than a giant conditional inside one body.
  if (questionnaire.direction === 'inbound') {
    return (
      <InboundDetailBody
        id={id}
        questionnaire={questionnaire}
        customer={customer}
        questions={questions}
      />
    );
  }

  return (
    <DetailBody
      id={id}
      questionnaire={questionnaire}
      customer={customer}
      document={document}
      questions={questions}
      byQ={byQ}
      generateAll={generateAll}
      exportToExcel={exportToExcel}
      finalizeMutation={finalizeMutation}
    />
  );
}

/**
 * Inbound detail page. Status-driven action bar drives the user through
 * the supplier-disclosure lifecycle: Export blank xlsx (draft) → Import
 * filled xlsx (sent) → Review & ingest (received) → View activities
 * (ingested).
 *
 * The body shows the question list with tier badges — no
 * AnswerReviewCard, because inbound answers come from the supplier via
 * import, not from the user's typing.
 */
function InboundDetailBody({
  id,
  questionnaire,
  customer,
  questions,
}: {
  id: string;
  questionnaire: Questionnaire;
  customer: { name: string };
  questions: Question[];
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const exportMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.exportXlsx({ questionnaire_id: id }),
    onSuccess: (r) => {
      if (r.canceled) return;
      toast.success(`已导出到 ${r.path}（${r.bytes_written} 字节）。将文件邮件发给供应商。`);
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const importMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.importPreview({ questionnaire_id: id }),
    onSuccess: (r) => {
      if (r.canceled) return;
      if ('error' in r) {
        toast.error('导入失败', { description: r.error.message });
        return;
      }
      toast.success(
        `已解析 ${r.preview.answers.filter((a) => !a.is_blank).length} 题答案。进入审核页面。`,
      );
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      void navigate({ to: '/questionnaires/$id/ingest', params: { id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 px-6 pt-6 pb-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
            Inbound · 供应商问卷
          </span>
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {questionnaire.reporting_year} · {statusLabelZh(questionnaire.status)} · Cat 1 Supplier
          Disclosure · {questions.length} 题
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-3 space-y-4">
        <InboundQuestionTable questions={questions} />
        <InboundStatusHint status={questionnaire.status} />
      </div>

      <div className="shrink-0 flex justify-end gap-2 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
        {questionnaire.status === 'draft' && (
          <Button
            type="button"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {exportMutation.isPending ? '导出中...' : '导出空白 xlsx'}
          </Button>
        )}
        {questionnaire.status === 'sent' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              重新导出
            </Button>
            <Button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {importMutation.isPending ? '导入中...' : '导入回填表'}
            </Button>
          </>
        )}
        {questionnaire.status === 'received' && (
          <Button
            type="button"
            onClick={() => void navigate({ to: '/questionnaires/$id/ingest', params: { id } })}
          >
            审核并入库
          </Button>
        )}
        {questionnaire.status === 'ingested' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: '/activities' })}
          >
            查看关联活动数据
          </Button>
        )}
      </div>
    </div>
  );
}

function statusLabelZh(status: string): string {
  switch (status) {
    case 'draft':
      return '草稿（待导出）';
    case 'sent':
      return '已发送供应商';
    case 'received':
      return '已收回（待审核）';
    case 'ingested':
      return '已入库';
    default:
      return status;
  }
}

function InboundStatusHint({ status }: { status: string }): JSX.Element | null {
  const hints: Record<string, string> = {
    draft:
      '下一步：点击右下角「导出空白 xlsx」，将文件邮件发给供应商。供应商填写后邮件回传，再回到本页面导入。',
    sent: '已发送给供应商。等待回传后，点击右下角「导入回填表」上传供应商邮件附件。',
    received:
      '供应商回传已解析，等待人工审核。点击「审核并入库」进入审核页面，确认无误后写入活动数据库。',
    ingested: '已入库。供应商回传的排放数据已写入 Scope 3 库存，可在「活动数据」页面查看。',
  };
  const text = hints[status];
  if (!text) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// Body is split out so the inventory-availability query chain can use the
// resolved reporting_year as a dependency, without each query running
// against `undefined` while q.data is still loading.
function DetailBody({
  id,
  questionnaire,
  customer,
  document,
  questions,
  byQ,
  generateAll,
  exportToExcel,
  finalizeMutation,
}: {
  id: string;
  questionnaire: { reporting_year: number; status: string };
  customer: { name: string };
  document: { filename: string };
  questions: Question[];
  byQ: Map<string, Answer>;
  generateAll: { mutate: () => void; isPending: boolean };
  exportToExcel: { mutate: () => void; isPending: boolean };
  finalizeMutation: { mutate: () => void; isPending: boolean };
}) {
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfLanguage, setPdfLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  const exportPdf = useMutation({
    mutationFn: () => questionnaireApi.exportPdf({ questionnaire_id: id, language: pdfLanguage }),
    onSuccess: (result) => {
      if ('canceled' in result && result.canceled) return;
      if ('ok' in result && result.ok) {
        toast.success(m.questionnaire_export_pdf_success({ path: result.path }));
      } else if ('ok' in result && !result.ok) {
        toast.error(m.questionnaire_export_pdf_failed({ message: result.error }));
      }
      setPdfDialogOpen(false);
    },
    onError: (e) =>
      toast.error(m.questionnaire_export_pdf_failed({ message: (e as Error).message })),
  });
  // Inventory availability chain — org → reporting periods (filter to this
  // questionnaire's year) → activities. If 0 activities, show a banner so
  // users understand WHY answer generation will fail before they click.
  const orgQuery = useQuery({ queryKey: ['org:get-current'], queryFn: orgApi.getCurrent });
  const orgId = orgQuery.data?.id;
  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId ?? '' }),
    enabled: !!orgId,
  });
  const period = periodsQuery.data?.find((p) => p.year === questionnaire.reporting_year);
  const activitiesQuery = useQuery({
    queryKey: ['activity:list-by-period', period?.id],
    queryFn: () => activityApi.listByPeriod({ reporting_period_id: period?.id ?? '' }),
    enabled: !!period?.id,
  });
  const inventoryEmpty =
    orgQuery.isSuccess &&
    periodsQuery.isSuccess &&
    (!period || (activitiesQuery.isSuccess && (activitiesQuery.data?.length ?? 0) === 0));

  return (
    // Sticky-top / scroll-middle / sticky-bottom layout (see CLAUDE.md
    // → Scroll containment). The h1 + meta + inventory warning stay
    // pinned at the top; the answer-card list scrolls in the middle;
    // the action bar (Generate all / Export Excel / Export PDF /
    // Finalize) stays pinned at the bottom so users don't have to
    // scroll past dozens of questions to reach Finalize. Parent
    // right-pane is overflow-hidden — see questionnaires.tsx.
    // Round 4: "返回问卷列表" back link removed — with the two-pane
    // layout the list is always visible on the left.
    <div className="flex h-full flex-col">
      {/* === Fixed top === */}
      <div className="shrink-0 space-y-4 px-6 pt-6 pb-3">
        <div>
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {questionnaire.reporting_year} · {questionnaire.status} · {document.filename}
          </p>
        </div>
        {inventoryEmpty && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-medium">
                {m.questionnaires_detail_inventory_empty_title({
                  year: questionnaire.reporting_year,
                })}
              </p>
              <p className="mt-0.5">
                {m.questionnaires_detail_inventory_empty_body()}{' '}
                <Link to="/activities" className="font-medium underline">
                  {m.questionnaires_detail_inventory_empty_cta()}
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* === Scrolling middle === */}
      <div className="flex-1 min-h-0 overflow-auto px-6">
        {questions.length === 0 ? (
          <p className="text-muted-foreground italic">{m.questionnaires_detail_answer_pending()}</p>
        ) : (
          <div className="space-y-4 py-3">
            {questions.map((question) => {
              const ans = byQ.get(question.id) ?? null;
              // Key on answer.id when present — when the answer transitions
              // from null (initial) to a real row, React remounts the card
              // so its internal useState picks up the new value/unit.
              // Without this remount, the inputs stay stuck on '' because
              // useState only honors the initializer on the FIRST render.
              return (
                <AnswerReviewCard
                  key={ans?.id ?? `pending-${question.id}`}
                  question={question}
                  answer={ans}
                  questionnaireId={id}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* === Fixed bottom action bar === */}
      {questions.length > 0 && (
        // Native action-bar hierarchy: one primary (filled green) for
        // the page's hero action — "确认全部答案" (finalize), the only
        // irreversible / state-mutating one. The other three are
        // exports / AI-batch generation — secondary by intent, so they
        // use `outline`. Avoids the previous "wall of identical green
        // buttons" pattern (skill 06 — reserve filled for ONE action).
        <div className="shrink-0 flex justify-end gap-2 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => generateAll.mutate()}
            disabled={generateAll.isPending}
          >
            {generateAll.isPending
              ? m.answer_generate_all_running()
              : m.answer_generate_all_button()}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => exportToExcel.mutate()}
            disabled={exportToExcel.isPending}
          >
            {exportToExcel.isPending ? m.answer_export_running() : m.answer_export_button()}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPdfDialogOpen(true)}>
            {m.questionnaire_export_pdf_button()}
          </Button>
          <Button
            type="button"
            onClick={() => finalizeMutation.mutate()}
            disabled={finalizeMutation.isPending}
          >
            {m.questionnaires_finalize_button()}
          </Button>
        </div>
      )}
      {pdfDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
        >
          <div className="bg-white rounded p-6 w-80 space-y-3 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">{m.questionnaire_export_pdf_dialog_heading()}</h2>
            <p className="text-sm text-muted-foreground">
              {m.questionnaire_export_pdf_dialog_subheading()}
            </p>
            <label className="block text-sm">
              {m.questionnaire_export_pdf_lang_label()}
              <select
                value={pdfLanguage}
                onChange={(e) => setPdfLanguage(e.target.value as 'zh-CN' | 'en')}
                className="block mt-1 border rounded px-2 py-1 w-full"
              >
                <option value="zh-CN">{m.questionnaire_export_pdf_lang_zh()}</option>
                <option value="en">{m.questionnaire_export_pdf_lang_en()}</option>
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPdfDialogOpen(false)}
                className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                {m.questionnaire_export_pdf_cancel()}
              </button>
              <button
                type="button"
                onClick={() => exportPdf.mutate()}
                disabled={exportPdf.isPending}
                className="rounded bg-black text-white px-3 py-1 text-sm disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {exportPdf.isPending
                  ? m.questionnaire_export_pdf_pending()
                  : m.questionnaire_export_pdf_confirm()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
