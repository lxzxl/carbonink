import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { extractionApi } from '@renderer/lib/api/extraction';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import type { BatchExtractionProgress } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanSearch, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Minimum ms between mid-batch list invalidations (terminal always fires). */
const INVALIDATE_THROTTLE_MS = 300;
/** Failure rows rendered inline before the +N truncation line. */
const MAX_VISIBLE_FAILURES = 5;

export interface BatchExtractionBarProps {
  /** Documents with no extraction yet — the pool a batch run covers. */
  pendingDocIds: string[];
}

/**
 * Batch extraction control (spec 2026-07-22): idle → "批量识别 (N)" button
 * (the LLM spend is authorized by this exact click); running → N/M progress
 * + cancel; terminal → summary toast + inline failure list until the next
 * run. Live state arrives on the extraction:batch-progress push channel
 * (full snapshots — no client-side accumulation); `extraction:batch-status`
 * hydrates after a remount so a batch started elsewhere isn't invisible.
 */
export function BatchExtractionBar({ pendingDocIds }: BatchExtractionBarProps) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchExtractionProgress | null>(null);
  const lastInvalidateRef = useRef(0);
  const sawRunningRef = useRef(false);

  const statusQuery = useQuery({
    queryKey: ['extraction:batch-status'],
    queryFn: extractionApi.batchStatus,
    // Hydration only — live updates come from the push channel.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const hydrated = progress ?? statusQuery.data ?? null;

  useEffect(() => {
    return subscribe('extraction:batch-progress', (payload) => {
      setProgress(payload);
      if (payload.running) sawRunningRef.current = true;

      const now = Date.now();
      const terminal = !payload.running;
      if (terminal || now - lastInvalidateRef.current > INVALIDATE_THROTTLE_MS) {
        lastInvalidateRef.current = now;
        void queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
        void queryClient.invalidateQueries({ queryKey: ['document:list'] });
      }
      if (terminal && sawRunningRef.current) {
        sawRunningRef.current = false;
        toast.success(
          payload.canceled
            ? m.documents_batch_canceled_toast({
                done: String(payload.done),
                total: String(payload.total),
              })
            : m.documents_batch_summary_toast({
                ok: String(payload.ok_count),
                failed: String(payload.failed_count),
              }),
        );
      }
    });
  }, [queryClient]);

  const runMutation = useMutation({
    mutationFn: () => extractionApi.batchRun({ document_ids: pendingDocIds }),
    onSuccess: (res) => {
      if (!res.ok && res.error._tag === 'BatchAlreadyRunning') {
        toast.error(m.documents_batch_already_running());
      }
    },
  });

  const running = hydrated?.running === true;

  if (!running && pendingDocIds.length === 0 && (hydrated?.failed_count ?? 0) === 0) {
    return null;
  }

  return (
    <div className="space-y-2 border-b border-border/40 px-4 py-2.5">
      {running && hydrated ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium tabular-nums">
              {m.documents_batch_progress({
                done: String(hydrated.done),
                total: String(hydrated.total),
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => void extractionApi.batchCancel()}
            >
              <Square className="size-3" aria-hidden="true" />
              {m.documents_batch_cancel()}
            </Button>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={hydrated.total}
            aria-valuenow={hydrated.done}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${(hydrated.done / Math.max(1, hydrated.total)) * 100}%` }}
            />
          </div>
        </div>
      ) : (
        pendingDocIds.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            title={m.documents_batch_hint({ count: String(pendingDocIds.length) })}
            disabled={runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            <ScanSearch className="size-3.5" aria-hidden="true" />
            {m.documents_batch_button({ count: String(pendingDocIds.length) })}
          </Button>
        )
      )}

      {!running && hydrated && hydrated.failed.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[11px] font-medium text-destructive">
            {m.documents_batch_failures_heading()}
          </p>
          <ul className="space-y-0.5">
            {hydrated.failed.slice(0, MAX_VISIBLE_FAILURES).map((f) => (
              <li
                key={f.document_id}
                className="truncate text-[11px] text-muted-foreground"
                title={f.detail ?? f.filename}
              >
                {f.filename} —{' '}
                {f.reason === 'classify_failed'
                  ? m.documents_batch_reason_classify_failed()
                  : m.documents_batch_reason_error()}
              </li>
            ))}
            {hydrated.failed_count > MAX_VISIBLE_FAILURES && (
              <li className="text-[11px] text-muted-foreground">
                +{hydrated.failed_count - MAX_VISIBLE_FAILURES}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
