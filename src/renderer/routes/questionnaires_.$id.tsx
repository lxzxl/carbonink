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

export const Route = createFileRoute('/questionnaires_/$id')({
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => generateAll.mutate()}
              disabled={generateAll.isPending}
            >
              {generateAll.isPending
                ? m.answer_generate_all_running()
                : m.answer_generate_all_button()}
            </Button>
            <Button
              type="button"
              onClick={() => exportToExcel.mutate()}
              disabled={exportToExcel.isPending}
            >
              {exportToExcel.isPending ? m.answer_export_running() : m.answer_export_button()}
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
    </div>
  );
}
