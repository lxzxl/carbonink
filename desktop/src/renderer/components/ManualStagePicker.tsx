import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { extractionApi } from '@renderer/lib/api/extraction';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const STAGES = [
  { id: 'china_utility.v1', label: '电费账单' },
  { id: 'fuel_receipt.v1', label: '加油发票' },
  { id: 'freight.v1', label: '货运发票' },
  { id: 'purchase.v1', label: '采购发票' },
  { id: 'travel.v1', label: '差旅票据' },
];

export interface ManualStagePickerProps {
  documentId: string;
  /**
   * Initial stage selection in the dropdown. Defaults to the first stage.
   */
  defaultStageId?: string | undefined;
  /**
   * Optional: if provided, discard this extraction id before running the new one.
   * Used by T8's "switch stage and re-extract" override.
   */
  discardExtractionId?: string | undefined;
  /**
   * Optional callback fired after the new extraction is successfully created.
   * The default behavior also invalidates the extraction query.
   */
  onConfirmed?: (() => void) | undefined;
  /**
   * Optional callback fired when the user cancels (only relevant in the
   * "switch stage" entry path where there's still a valid extraction to
   * keep). When omitted no Cancel button renders.
   */
  onCancel?: (() => void) | undefined;
}

export function ManualStagePicker({
  documentId,
  defaultStageId,
  discardExtractionId,
  onConfirmed,
  onCancel,
}: ManualStagePickerProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>(defaultStageId ?? STAGES[0]?.id ?? '');

  const mutation = useMutation({
    mutationFn: async () => {
      if (discardExtractionId) {
        await extractionApi.discard({ id: discardExtractionId });
      }
      return extractionApi.run({ document_id: documentId, stage_id: selected });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', documentId],
      });
      toast.success(m.documents_review_reextract_success());
      onConfirmed?.();
    },
    // Without this, IPC failures (license-gate block, LLM error, missing
    // document, network) get swallowed and the button looks unresponsive
    // after the spinner resolves — user just sees "确认重抽" again with no
    // explanation. A toast surfaces the real reason.
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_reextract_failed(), { description: msg });
    },
  });

  const isSwitchMode = !!discardExtractionId;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      {/* Header line: explanatory body text per entry path.
       *   - auto-classify-failed (no discardExtractionId): "we couldn't
       *     identify the doc type — pick manually".
       *   - switch-stage mode (discardExtractionId set): "this will
       *     discard the current extraction and re-run" — without this
       *     warning the destructive nature of the action was hidden. */}
      <p className="text-sm text-foreground/80">
        {isSwitchMode ? m.documents_review_reextract_body() : m.documents_review_classify_failed()}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="stage-picker-select" className="text-xs">
          {m.documents_review_reextract_stage_label()}
        </Label>
        <div className="flex items-center gap-2">
          {/* Select + button share the same `h-9` so they line up. The
           * previous `px-2 py-1` select rendered at ~h-7 while Button
           * defaulted to h-9 — the two looked mismatched in pairs. */}
          <select
            id="stage-picker-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            disabled={mutation.isPending}
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending
              ? m.documents_review_extracting()
              : m.documents_review_reextract_confirm()}
          </Button>
          {/* Cancel only renders in switch-stage mode — auto-classify-
           * failed mode has no extraction to keep so there's nothing
           * to cancel back to. */}
          {isSwitchMode && onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={mutation.isPending}
            >
              {m.cancel()}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
