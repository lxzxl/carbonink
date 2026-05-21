import { ListItem } from '@renderer/components/app-shell/ListItem';
import { Button } from '@renderer/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import type { Questionnaire } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

/**
 * /questionnaires — two-pane layout (Phase D of the UI redesign).
 * Mirrors the documents two-pane pattern: list on left, detail in Outlet
 * on right. The previous flat `/questionnaires_/$id` route is now
 * nested under this layout as `/questionnaires/$id`.
 */
export const Route = createFileRoute('/questionnaires')({
  component: QuestionnairesLayout,
});

function QuestionnairesLayout() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full -m-6">
      {/* v4 breaking: sizes are strings with "%" suffix (numbers = px). */}
      <ResizablePanel
        defaultSize="32%"
        minSize="22%"
        maxSize="50%"
        className="border-r border-border/60"
      >
        <QuestionnairesListColumn />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="68%">
        <div className="h-full overflow-auto p-6">
          <Outlet />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

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

function QuestionnairesListColumn() {
  const params = useParams({ strict: false }) as { id?: string };
  const selectedId = params.id;
  const q = useQuery({
    queryKey: ['questionnaire:list'],
    queryFn: questionnaireApi.list,
  });

  const list = (q.data ?? []) as Array<
    Questionnaire & { customer_name: string; question_count: number }
  >;

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background/85 backdrop-blur-sm px-4 py-3 border-b border-border/60">
        <h1 className="text-sm font-semibold">{m.nav_questionnaires()}</h1>
        {/* New-questionnaire CTA promoted to a compact icon-text button in
         * the list-column header. The previous list-page used a heavier
         * `bg-primary` filled button at the top — too loud for native chrome. */}
        <Button asChild variant="outline" size="sm">
          <Link to="/questionnaires/new" className="gap-1">
            <Plus className="size-3.5" aria-hidden="true" />
            {m.questionnaires_new_button()}
          </Link>
        </Button>
      </header>

      {q.isLoading ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{m.loading()}</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{m.questionnaires_empty()}</p>
      ) : (
        <ul className="py-1">
          {list.map((r) => (
            <ListItem
              key={r.id}
              to="/questionnaires/$id"
              params={{ id: r.id }}
              isSelected={r.id === selectedId}
              title={r.customer_name}
              titleAttr={r.customer_name}
              meta={
                <>
                  <span>{r.reporting_year}</span>
                  <span>·</span>
                  <span>{statusLabel(r.status)}</span>
                  <span>·</span>
                  <span>
                    {r.question_count} {m.questionnaires_table_questions()}
                  </span>
                  {r.due_date && (
                    <>
                      <span>·</span>
                      <span>
                        {m.questionnaires_table_due()} {r.due_date}
                      </span>
                    </>
                  )}
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
