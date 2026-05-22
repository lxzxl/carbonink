import * as m from '@renderer/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';

/**
 * /reports (exact) — right-pane empty state when no period selected.
 */
export const Route = createFileRoute('/reports/')({
  component: ReportsIndex,
});

function ReportsIndex() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <ScrollText
        className="size-12 text-muted-foreground/50"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <p className="mt-3 text-sm text-muted-foreground">{m.reports_list_subheading()}</p>
    </div>
  );
}
