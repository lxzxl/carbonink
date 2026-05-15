import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/questionnaires/$id')({
  component: QuestionnaireDetailRoute,
});

function QuestionnaireDetailRoute() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ['questionnaire:get-by-id', id],
    queryFn: () => questionnaireApi.getById({ id }),
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
        <p className="text-muted-foreground italic">
          {m.questionnaires_detail_answer_pending()}
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 text-left">{m.questionnaires_detail_question()}</th>
                <th className="text-left">{m.questionnaires_detail_kind()}</th>
                <th className="text-left">{m.questionnaires_detail_unit()}</th>
                <th className="text-left">{m.questionnaires_detail_position()}</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className="border-b">
                  <td className="py-2">{q.raw_text}</td>
                  <td>{q.question_kind}</td>
                  <td>{q.expected_unit ?? '—'}</td>
                  <td className="font-mono text-xs">{q.position ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground italic">
            {m.questionnaires_detail_answer_pending()}
          </p>
        </>
      )}
    </div>
  );
}
