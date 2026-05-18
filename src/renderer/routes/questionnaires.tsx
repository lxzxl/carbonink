import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import type { Questionnaire } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/questionnaires')({
  component: QuestionnairesRoute,
});

function statusLabel(status: string): string {
  switch (status) {
    case 'parsing':
      return m.questionnaires_status_parsing();
    case 'mapping':
      return m.questionnaires_status_mapping();
    case 'answering':
      return m.questionnaires_status_answering();
    case 'exported':
      return m.questionnaires_status_exported();
    default:
      return status;
  }
}

function QuestionnairesRoute() {
  const q = useQuery({
    queryKey: ['questionnaire:list'],
    queryFn: questionnaireApi.list,
  });

  if (q.isLoading) return <p className="text-muted-foreground">{m.loading()}</p>;

  // The API returns Array<Questionnaire & { customer_name; question_count }>
  // Type assertion needed since the IPC response isn't fully typed yet.
  const list = (q.data ?? []) as Array<
    Questionnaire & { customer_name: string; question_count: number }
  >;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.nav_questionnaires()}</h1>
        <Link
          to="/questionnaires/new"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          {m.questionnaires_new_button()}
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-muted-foreground">{m.questionnaires_empty()}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{m.questionnaires_table_customer()}</th>
                <th className="px-3 py-2 font-medium">{m.questionnaires_table_year()}</th>
                <th className="px-3 py-2 font-medium">{m.questionnaires_table_status()}</th>
                <th className="px-3 py-2 font-medium">{m.questionnaires_table_questions()}</th>
                <th className="px-3 py-2 font-medium">{m.questionnaires_table_due()}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      to="/questionnaires/$id"
                      params={{ id: r.id }}
                      className="text-primary hover:underline"
                    >
                      {r.customer_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.reporting_year}</td>
                  <td className="px-3 py-2">{statusLabel(r.status)}</td>
                  <td className="px-3 py-2">{r.question_count}</td>
                  <td className="px-3 py-2">{r.due_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
