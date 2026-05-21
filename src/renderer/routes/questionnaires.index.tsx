import * as m from '@renderer/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';

/**
 * /questionnaires (exact) — right-pane empty state when nothing selected.
 */
export const Route = createFileRoute('/questionnaires/')({
  component: QuestionnairesIndex,
});

function QuestionnairesIndex() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <ClipboardList
        className="size-12 text-muted-foreground/50"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <p className="mt-3 text-sm text-muted-foreground">{m.questionnaires_empty()}</p>
    </div>
  );
}
