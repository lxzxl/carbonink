import { AnswerReviewCard } from '@renderer/components/AnswerReviewCard';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { answerApi } from '@renderer/lib/api/answer';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import type { Answer } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

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
      {questions.length === 0 ? (
        <p className="text-muted-foreground italic">{m.questionnaires_detail_answer_pending()}</p>
      ) : (
        <>
          <div className="space-y-4">
            {questions.map((question) => (
              <AnswerReviewCard
                key={question.id}
                question={question}
                answer={byQ.get(question.id) ?? null}
                questionnaireId={id}
              />
            ))}
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
