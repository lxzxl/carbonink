import { Button } from '@renderer/components/ui/button';
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
}

export function ManualStagePicker({
  documentId,
  defaultStageId,
  discardExtractionId,
  onConfirmed,
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
      onConfirmed?.();
    },
  });

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      {!discardExtractionId && <p className="text-sm">{m.documents_review_classify_failed()}</p>}
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          disabled={mutation.isPending}
        >
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? m.documents_review_extracting() : '确认重抽'}
        </Button>
      </div>
    </div>
  );
}
