import { settingsApi } from '@renderer/lib/api/settings';
import * as m from '@renderer/paraglide/messages';
import { ProviderNotConfiguredBanner } from '@renderer/routes/documents';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FileText } from 'lucide-react';

/**
 * /documents (exact) — right-pane content when no document is selected.
 *
 * Renders either:
 *   - the "AI provider not configured" banner (if settings empty), so
 *     the user fixes that before uploading; the left-pane upload zone
 *     is also hidden in that state by the parent layout.
 *   - a friendly "pick a document on the left" empty state with a
 *     terse icon + 1-line hint (skill 06 — native empty states under-explain).
 */
export const Route = createFileRoute('/documents/')({
  component: DocumentsIndex,
});

function DocumentsIndex() {
  const providerQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
  });

  // Parent right-pane is overflow-hidden with no padding (see documents.tsx
  // — CLAUDE.md → Scroll containment). Each branch supplies its own
  // padding so content doesn't touch the panel edge. The empty-state
  // branch is centered both axes via `h-full`, so it needs no padding.
  if (providerQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">{m.loading()}</p>;
  }
  if (providerQuery.data == null) {
    return (
      <div className="p-6">
        <ProviderNotConfiguredBanner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <FileText className="size-12 text-muted-foreground/50" strokeWidth={1.5} aria-hidden="true" />
      <p className="mt-3 text-sm text-muted-foreground">{m.documents_empty()}</p>
    </div>
  );
}
