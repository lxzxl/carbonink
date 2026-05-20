import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';

export const Route = createFileRoute('/reports')({
  component: ReportsList,
});

export function ReportsList() {
  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });
  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgQuery.data?.id],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgQuery.data!.id }),
    enabled: !!orgQuery.data?.id,
  });

  const profileReady = !!orgQuery.data?.responsible_person_name;

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">{m.reports_list_heading()}</h1>
      <p className="text-sm text-muted-foreground mb-6">{m.reports_list_subheading()}</p>

      {!profileReady && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 mb-4 text-sm">
          {m.reports_setup_required()}
        </div>
      )}

      <ul className="space-y-2">
        {periodsQuery.data?.length ? (
          periodsQuery.data.map((p) => (
            <li key={p.id} className="rounded border p-3 flex items-center justify-between">
              <span>{p.year} · {p.granularity}</span>
              <Link
                to="/reports/$id"
                params={{ id: p.id }}
                className={`text-sm underline ${profileReady ? '' : 'pointer-events-none opacity-40'}`}
              >
                {m.reports_new_cta()}
              </Link>
            </li>
          ))
        ) : (
          <li className="text-sm text-muted-foreground">{m.reports_no_periods()}</li>
        )}
      </ul>
    </div>
  );
}
