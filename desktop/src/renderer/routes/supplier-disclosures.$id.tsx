import { InboundQuestionTable } from '@renderer/components/inbound/InboundQuestionTable';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { answerApi } from '@renderer/lib/api/answer';
import { inboundQuestionnaireApi } from '@renderer/lib/api/inbound-questionnaire';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import type { Question, Questionnaire } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, Upload } from 'lucide-react';
import { useMemo } from 'react';

/**
 * `/supplier-disclosures/$id` — inbound supplier-disclosure detail.
 *
 * Status-driven action bar drives the user through the
 * supplier-disclosure lifecycle:
 *   draft     → [Export blank xlsx]
 *   sent      → [Re-export] [Import filled xlsx]
 *   received  → [Review and ingest]
 *   ingested  → [View linked activities]
 *
 * Body shows the question list with tier badges + a status-conditional
 * hint banner explaining the next step. No AnswerReviewCard — inbound
 * answers come from the supplier via import, not from user typing.
 *
 * Note: this route only handles direction='inbound' rows. Outbound rows
 * live under `/questionnaires/$id` and have a completely different
 * action bar (AI generate, finalize, export-to-customer).
 */
export const Route = createFileRoute('/supplier-disclosures/$id')({
  component: SupplierDisclosureDetailRoute,
});

function SupplierDisclosureDetailRoute(): JSX.Element {
  const { id } = Route.useParams();

  const q = useQuery({
    queryKey: ['questionnaire:get-by-id', id],
    queryFn: () => questionnaireApi.getById({ id }),
  });

  if (q.isLoading) return <p className="p-6 text-muted-foreground">加载中…</p>;
  if (!q.data) {
    return (
      <div className="space-y-4 p-6">
        <Link to="/supplier-disclosures" className="text-sm text-primary hover:underline">
          ← 返回披露列表
        </Link>
        <p className="text-destructive">披露不存在。</p>
      </div>
    );
  }
  const { questionnaire, customer, questions } = q.data;

  // Defense in depth: a stale URL to an outbound questionnaire under
  // this route shouldn't render the inbound action bar. Redirect-feel
  // banner steers the user to the right place.
  if (questionnaire.direction !== 'inbound') {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-destructive">这条记录是「客户披露填报」，不在此处。</p>
        <Link
          to="/questionnaires/$id"
          params={{ id }}
          className="text-sm text-primary hover:underline"
        >
          → 转到披露填报详情
        </Link>
      </div>
    );
  }

  return (
    <InboundDetailBody
      id={id}
      questionnaire={questionnaire}
      supplier={customer}
      questions={questions}
    />
  );
}

function InboundDetailBody({
  id,
  questionnaire,
  supplier,
  questions,
}: {
  id: string;
  questionnaire: Questionnaire;
  supplier: { name: string };
  questions: Question[];
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Once the supplier's reply is imported (status='received') or ingested,
  // surface the captured values inline on this page. Without this, the
  // detail page shows only the bare question list after a successful
  // import — which reads as "no answers were recognized" even though the
  // import worked. The dedicated /ingest page is still where accept/reject
  // happens; this is just a read-only echo so the import result is visible.
  const showAnswers = questionnaire.status === 'received' || questionnaire.status === 'ingested';
  const answersQuery = useQuery({
    queryKey: ['answer:list-by-questionnaire', id],
    queryFn: () => answerApi.listByQuestionnaire(id),
    enabled: showAnswers,
  });
  const answersByQuestionId = useMemo(() => {
    const m = new Map<string, { value: string; unit: string | null }>();
    for (const a of answersQuery.data ?? []) {
      m.set(a.question_id, { value: a.value, unit: a.unit });
    }
    return m;
  }, [answersQuery.data]);

  const exportMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.exportXlsx({ questionnaire_id: id }),
    onSuccess: (r) => {
      if (r.canceled) return;
      toast.success(`已导出到 ${r.path}（${r.bytes_written} 字节）。将文件邮件发给供应商。`);
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const importMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.importPreview({ questionnaire_id: id }),
    onSuccess: (r) => {
      if (r.canceled) return;
      if ('error' in r) {
        toast.error('导入失败', { description: r.error.message });
        return;
      }
      toast.success(
        `已解析 ${r.preview.answers.filter((a) => !a.is_blank).length} 题答案。进入审核页面。`,
      );
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      void queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', id] });
      void navigate({ to: '/supplier-disclosures/$id/ingest', params: { id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 px-6 pt-6 pb-3">
        <h1 className="text-2xl font-semibold">{supplier.name}</h1>
        <p className="text-sm text-muted-foreground">
          {questionnaire.reporting_year} · {statusLabel(questionnaire.status)} · Cat 1 Supplier
          Disclosure · {questions.length} 题
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-3 space-y-4">
        <InboundQuestionTable
          questions={questions}
          {...(showAnswers ? { answersByQuestionId } : {})}
        />
        <StatusHint status={questionnaire.status} />
      </div>

      <div className="shrink-0 flex justify-end gap-2 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
        {questionnaire.status === 'draft' && (
          <Button
            type="button"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {exportMutation.isPending ? '导出中...' : '导出空白 xlsx'}
          </Button>
        )}
        {questionnaire.status === 'sent' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              重新导出
            </Button>
            <Button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {importMutation.isPending ? '导入中...' : '导入回填表'}
            </Button>
          </>
        )}
        {questionnaire.status === 'received' && (
          <Button
            type="button"
            onClick={() =>
              void navigate({ to: '/supplier-disclosures/$id/ingest', params: { id } })
            }
          >
            审核并入库
          </Button>
        )}
        {questionnaire.status === 'ingested' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: '/activities' })}
          >
            查看关联活动数据
          </Button>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return '草稿（待导出）';
    case 'sent':
      return '已发送供应商';
    case 'received':
      return '已收回（待审核）';
    case 'ingested':
      return '已入库';
    default:
      return status;
  }
}

function StatusHint({ status }: { status: string }): JSX.Element | null {
  const hints: Record<string, string> = {
    draft:
      '下一步：点击右下角「导出空白 xlsx」，将文件邮件发给供应商。供应商填写后邮件回传，再回到本页面导入。',
    sent: '已发送给供应商。等待回传后，点击右下角「导入回填表」上传供应商邮件附件。',
    received:
      '供应商回传已解析，等待人工审核。点击「审核并入库」进入审核页面，确认无误后写入活动数据库。',
    ingested: '已入库。供应商回传的排放数据已写入 Scope 3 库存，可在「活动数据」页面查看。',
  };
  const text = hints[status];
  if (!text) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {text}
    </div>
  );
}
