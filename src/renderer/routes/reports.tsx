import { ListItem } from '@renderer/components/app-shell/ListItem';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';

/**
 * /reports — two-pane layout (Phase D of the UI redesign).
 *
 * Periods on the left (compact rows); the active period's report editor in
 * the right Outlet. The previous flat `/reports_/$id` route is now nested
 * here as `/reports/$id`.
 */
export const Route = createFileRoute('/reports')({
  component: ReportsLayout,
});

export function ReportsLayout() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full -m-6">
      <ResizablePanel
        defaultSize={28}
        minSize={20}
        maxSize={45}
        className="border-r border-border/60"
      >
        <ReportsListColumn />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={72}>
        <div className="h-full overflow-auto p-6">
          <Outlet />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function ReportsListColumn() {
  const params = useParams({ strict: false }) as { id?: string };
  const selectedId = params.id;

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
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-sm px-4 py-3 border-b border-border/60">
        <h1 className="text-sm font-semibold">{m.reports_list_heading()}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{m.reports_list_subheading()}</p>
      </header>

      {!profileReady && (
        <div className="m-3 rounded-md border border-amber-300/60 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/10 p-3 text-xs">
          {m.reports_setup_required()}
        </div>
      )}

      {periodsQuery.isLoading ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{m.loading()}</p>
      ) : periodsQuery.data?.length ? (
        <ul className="py-1">
          {periodsQuery.data.map((p) => (
            <ListItem
              key={p.id}
              to="/reports/$id"
              params={{ id: p.id }}
              isSelected={p.id === selectedId}
              className={profileReady ? undefined : 'pointer-events-none opacity-40'}
              title={p.year}
              meta={<span>{p.granularity}</span>}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center py-12 px-4 text-center">
          <div className="text-sm text-muted-foreground">{m.reports_no_periods()}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Kept for the import compatibility of `tests/renderer/reports-page.test.tsx`
 * which imports `ReportsList` directly. Re-exports the layout so existing
 * assertions about the page heading + link continue to pass.
 */
export { ReportsLayout as ReportsList };
