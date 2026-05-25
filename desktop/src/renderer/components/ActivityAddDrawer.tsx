import { ActivityDocumentDropzone } from '@renderer/components/ActivityDocumentDropzone';
import { ActivityForm, type ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import { buildChinaUtilityInitialValues } from '@renderer/components/extractions/china-utility/prefill';
import { buildFreightInitialValues } from '@renderer/components/extractions/freight/prefill';
import { buildFuelReceiptInitialValues } from '@renderer/components/extractions/fuel-receipt/prefill';
import { buildPurchaseInitialValues } from '@renderer/components/extractions/purchase/prefill';
import { buildTravelInitialValues } from '@renderer/components/extractions/travel/prefill';
import { parseExtraction } from '@renderer/components/extractions/types';
import { toast } from '@renderer/components/toast';
import { extractionApi } from '@renderer/lib/api/extraction';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, Document, EmissionSource, Extraction } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';

/**
 * Right-side "add an activity" drawer. Wraps ActivityForm in the same
 * vaul shell as SourceAddDrawer / SourceEditDrawer / SourceCatalogDrawer
 * — create, edit and browse all feel like one drawer family across the
 * app.
 *
 * Width: 720px. ActivityForm is denser than SourceForm — date pair +
 * amount/unit pair use grid-cols-2, and the EF Picker has an internal
 * list + filter. At 720px those two-column grids and the EF list both
 * fit comfortably without horizontal compression.
 *
 * Document-assisted entry:
 *   When the user drops a PDF into the embedded dropzone, we run the
 *   same `documentApi.upload` + `extractionApi.classifyAndRun` pipeline
 *   the /documents review flow uses. The resulting Extraction is fed
 *   through the per-stage `buildXxxInitialValues` helper, which
 *   produces the same prefill payload ExtractionReview hands to
 *   ActivityForm — so the LLM-extracted fields populate the form
 *   directly here. On successful submit we also fire
 *   `extractionApi.confirm` (matching the /documents review behavior)
 *   so the extraction's status flips to 'parsed' instead of staying
 *   'review_needed'.
 *
 *   `key={linkedExtraction?.extraction.id ?? 'blank'}` forces
 *   ActivityForm to remount when an extraction lands, picking up the
 *   new initialValues. TanStack Form only honors `defaultValues` at
 *   mount; without the remount we'd have to do N `setFieldValue`
 *   calls from outside, which is messier and would clobber any input
 *   the user had typed before the upload.
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface ActivityAddDrawerProps {
  organizationId: string;
  sources: EmissionSource[];
  open: boolean;
  onClose: () => void;
}

interface LinkedExtraction {
  extraction: Extraction;
  document: Document;
}

/**
 * Translate the classify-and-run result into ActivityForm's
 * `initialValues` shape by dispatching on the extraction's
 * prompt_version. Falls back to an undefined return (no prefill) when
 * the parsed JSON doesn't match the stage's schema — the user can
 * still fill the form by hand.
 */
function buildInitialValuesFromExtraction(
  linked: LinkedExtraction | null,
): ActivityFormInitialValues | undefined {
  if (!linked) return undefined;
  const { extraction, document } = linked;
  const parsed = parseExtraction(extraction.parsed_json, extraction.prompt_version);
  if (!parsed) return undefined;
  const matcherHint = {
    extraction_id: extraction.id,
    stage_id: extraction.prompt_version,
  };
  switch (parsed.stage) {
    case 'china_utility.v1':
      return buildChinaUtilityInitialValues(parsed.data, document.filename, matcherHint);
    case 'fuel_receipt.v1':
      return buildFuelReceiptInitialValues(parsed.data, document.filename, matcherHint);
    case 'freight.v1':
      return buildFreightInitialValues(parsed.data, document.filename, matcherHint);
    case 'purchase.v1':
      return buildPurchaseInitialValues(parsed.data, document.filename, matcherHint);
    case 'travel.v1':
      return buildTravelInitialValues(parsed.data, document.filename, matcherHint);
  }
}

export function ActivityAddDrawer({
  organizationId,
  sources,
  open,
  onClose,
}: ActivityAddDrawerProps) {
  const queryClient = useQueryClient();
  const [linked, setLinked] = useState<LinkedExtraction | null>(null);

  // Reset linkage when the drawer closes — opening it for a fresh
  // activity shouldn't inherit the last session's uploaded doc.
  useEffect(() => {
    if (!open) setLinked(null);
  }, [open]);

  const initialValues = useMemo(() => buildInitialValuesFromExtraction(linked), [linked]);

  // Mirror the /documents review confirm flow: after the activity row
  // is created, flip the extraction status to 'parsed' so the doc
  // shows the "已确认" panel in its own detail view. Without this the
  // extraction stays 'review_needed' even though we've already
  // consumed it.
  async function handleSubmitSuccess(_activity: ActivityData) {
    if (!linked) return;
    try {
      await extractionApi.confirm({ id: linked.extraction.id });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', linked.document.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    } catch (err) {
      // Best-effort — the activity is already created, so we surface
      // this as a non-blocking warning. The user can mark the
      // extraction confirmed manually on /documents/$id.
      toast.warning(m.documents_review_confirm_failed(), {
        description: friendlyErrorDescription(err),
      });
    }
  }

  if (!open) return null;

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[720px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.activities_add_button()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close add-activity drawer"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Document-assisted entry. Drops the doc → kicks off the
             * same AI extraction the /documents flow uses → prefills
             * the form below. Skippable: users can still type
             * everything by hand. */}
            <ActivityDocumentDropzone onParsed={setLinked} />

            {/* "AI 已自动填写" banner — shows when an extraction landed
             * AND we successfully translated it into initialValues.
             * Failed parses (unknown stage, bad JSON) silently keep
             * the form blank; the dropzone's pill above is enough
             * signal that the doc was attached, just not used. */}
            {linked && initialValues && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span>{m.activity_doc_prefilled_banner()}</span>
              </div>
            )}

            <ActivityForm
              key={linked?.extraction.id ?? 'blank'}
              organizationId={organizationId}
              sources={sources}
              onCancel={onClose}
              onSuccess={onClose}
              onSubmitSuccess={handleSubmitSuccess}
              {...(initialValues ? { initialValues } : {})}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
