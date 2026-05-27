import { Main } from '@renderer/components/layout/main';
import { Button } from '@renderer/components/ui/button';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

/**
 * `/questionnaires/$id/ingest` — inbound review-and-confirm page.
 *
 * **T10c will replace this stub.** For now it's a placeholder so the
 * route exists in the tree (other detail-page navigations point at it).
 * T10c will add: side-by-side preview table, per-row accept/reject,
 * Tier 1 quantity input, and the Confirm-and-ingest action.
 */
export const Route = createFileRoute('/questionnaires/$id/ingest')({
  component: IngestReviewStub,
});

function IngestReviewStub(): JSX.Element {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-auto">
      <Main className="max-w-2xl space-y-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ to: '/questionnaires/$id', params: { id } })}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回详情
        </Button>
        <h1 className="text-2xl font-semibold">审核并入库（T10c 即将到来）</h1>
        <p className="text-sm text-muted-foreground">
          这是占位页。T10c 将渲染：每题的供应商填写值、tier 选择、Tier 1
          路径的「采购数量」输入、最终的「确认入库」按钮。
        </p>
      </Main>
    </div>
  );
}
