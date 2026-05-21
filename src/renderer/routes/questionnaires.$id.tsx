import { AnswerReviewCard } from '@renderer/components/AnswerReviewCard';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { activityApi } from '@renderer/lib/api/activity-data';
import { answerApi } from '@renderer/lib/api/answer';
import { orgApi } from '@renderer/lib/api/organization';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import type { Answer, Question } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
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
    <div className="space-y-6">
      <Link to="/questionnaires" className="text-sm text-primary hover:underline">
        {m.questionnaires_detail_back()}
      </Link>
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
      {questions.length === 0 ? (
        <p className="text-muted-foreground italic">{m.questionnaires_detail_answer_pending()}</p>
      ) : (
        <>
          <div className="space-y-4">
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
          {/* Native action-bar hierarchy: one primary (filled green) for
           * the page's hero action — "确认全部答案" (finalize), the only
           * irreversible / state-mutating one. The other three are
           * exports / AI-batch generation — secondary by intent, so they
           * use `outline`. Avoids the previous "wall of identical green
           * buttons" pattern (skill 06 — reserve filled for ONE action). */}
          <div className="flex justify-end gap-2">
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
        </>
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
