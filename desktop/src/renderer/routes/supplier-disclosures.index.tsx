import { createFileRoute } from '@tanstack/react-router';
import { Download } from 'lucide-react';

/**
 * /supplier-disclosures (exact) — right-pane empty state when nothing
 * selected. The list column on the left invites a new disclosure.
 */
export const Route = createFileRoute('/supplier-disclosures/')({
  component: SupplierDisclosuresIndex,
});

function SupplierDisclosuresIndex(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Download className="size-12 text-muted-foreground/50" strokeWidth={1.5} aria-hidden="true" />
      <p className="mt-3 text-sm text-muted-foreground">从左侧选择一份供应商披露查看详情。</p>
    </div>
  );
}
