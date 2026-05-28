import { createFileRoute, Outlet } from '@tanstack/react-router';

/**
 * `/supplier-disclosures/$id` — layout shell for one disclosure.
 *
 * Pure pass-through: renders `<Outlet/>` so the nested routes mount —
 * the detail body lives in `supplier-disclosures.$id.index.tsx` (exact
 * `/$id`) and the review-and-ingest page in
 * `supplier-disclosures.$id.ingest.tsx` (`/$id/ingest`).
 *
 * Without this layer rendering an Outlet, navigating to `/$id/ingest`
 * would silently re-show the detail body (the child never mounts under a
 * leaf parent) — which is exactly the "审核并入库 没反应" bug this fixes.
 */
export const Route = createFileRoute('/supplier-disclosures/$id')({
  component: SupplierDisclosureIdLayout,
});

function SupplierDisclosureIdLayout(): JSX.Element {
  return <Outlet />;
}
