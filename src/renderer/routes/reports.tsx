import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

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
        <div className="rounded-md border border-amber-300/60 bg-amber-50/70 dark:bg-amber-500/10 dark:border-amber-500/40 p-3 mb-4 text-sm">
          {m.reports_setup_required()}
        </div>
      )}

      {/* Three render paths:
       *   - No periods at all → terse native empty state (icon + 1 line)
       *   - 1+ periods → card-style rows (border + bg + chevron)
       * The previous treatment was a single underlined link per row which
       * left the page feeling like a sparse list of footnotes. Skill 06 —
       * native apps over-explain empty states less and use real cards
       * for navigable rows. */}
      {periodsQuery.data?.length ? (
        <ul className="space-y-2">
          {periodsQuery.data.map((p) => (
            <li key={p.id}>
              <Link
                to="/reports/$id"
                params={{ id: p.id }}
                className={`block rounded-lg border border-border/60 bg-card/40 p-4 text-sm transition-colors hover:bg-card/80 ${profileReady ? '' : 'pointer-events-none opacity-40'}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{p.year}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.granularity}</div>
                  </div>
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-sm font-medium text-foreground">{m.reports_no_periods()}</div>
        </div>
      )}
    </div>
  );
}
