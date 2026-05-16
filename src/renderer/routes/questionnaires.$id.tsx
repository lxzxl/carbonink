import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { AnswerReviewCard } from '@renderer/components/AnswerReviewCard';
import { answerApi } from '@renderer/lib/api/answer';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import type { Answer } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

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

  const byQ = new Map<string, Answer>(
    (answersQuery.data ?? []).map((a) => [a.question_id, a]),
  );

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
          <div className="flex justify-end">
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
