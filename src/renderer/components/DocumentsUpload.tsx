import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import * as m from '@renderer/paraglide/messages';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * Phase 1b — drag-drop upload zone for source PDFs.
 *
 * Two-step pipeline per drop:
 *   1. `document:upload` — write file, dedupe by sha256, return a Document row.
 *   2. `extraction:run` (stage `china_utility.v1`) — parse PDF text → LLM →
 *      `extraction` row with `status='review_needed'`.
 *
 * Both steps surface their own toast on success/failure so the user knows
 * *which* step broke if the LLM call fails after a successful upload. The
 * extraction is fired-and-forgot inside this component (no `await` on the
 * UI thread for the LLM call — the toast resolves async and the list query
 * is invalidated). Re-running extraction on an already-extracted doc is
 * idempotent at the service layer (cache hit), so the worst case is a
 * wasted IPC round-trip.
 *
 * Status state machine for the visual progress label:
 *   idle → uploading → extracting → done → idle (after ~1.5s)
 *
 * Disabled state covers all non-idle states. We do NOT prevent re-render
 * during extraction — clicking the zone or dropping during extracting just
 * no-ops via the disabled `<input>` and the early-return in `handleFile`.
 */
type UploadState = 'idle' | 'uploading' | 'extracting' | 'done';

const ACCEPT = 'application/pdf';
const STAGE_ID = 'china_utility.v1';

export function DocumentsUpload() {
  const [state, setState] = useState<UploadState>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  async function handleFile(file: File): Promise<void> {
    if (state !== 'idle') return;
    if (file.type !== ACCEPT) {
      toast.error(m.documents_upload_failed(), {
        description: m.documents_upload_pdf_only(),
      });
      return;
    }

    setState('uploading');
    let doc: Awaited<ReturnType<typeof documentApi.upload>>;
    try {
      const buffer = await file.arrayBuffer();
      doc = await documentApi.upload({
        filename: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(buffer),
      });
      toast.success(m.documents_upload_success(), { description: file.name });
      // Refresh the list immediately so the row shows up while extraction
      // runs in the background.
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
      setState('idle');
      return;
    }

    setState('extracting');
    try {
      await extractionApi.run({ document_id: doc.id, stage_id: STAGE_ID });
      toast.success(m.documents_extraction_done(), { description: file.name });
      // Invalidate everything that may have changed: the per-doc extraction
      // list (powers the row-level status badge) and the global pending list
      // (Phase 1c may surface a count in the sidebar).
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', doc.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_extraction_failed(), { description: msg });
    } finally {
      setState('done');
      // Brief "Done" state so the user gets a confirmation flash, then back
      // to idle so they can drop another file. 1.2s is the same hold sonner
      // uses for a success toast by default.
      setTimeout(() => {
        setState('idle');
      }, 1200);
    }
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset the input so dropping the *same* file twice in a row still fires
    // change. The default behavior keeps the value and silently ignores
    // re-selection of an identical file.
    e.target.value = '';
  }

  const disabled = state !== 'idle';
  const label =
    state === 'uploading'
      ? m.documents_uploading()
      : state === 'extracting'
        ? m.documents_extracting()
        : state === 'done'
          ? m.documents_upload_done()
          : m.documents_upload_hint();

  return (
    <label
      htmlFor="documents-upload-input"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      data-state={state}
      data-dragging={isDragging || undefined}
      className={[
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-sm transition-colors',
        'hover:border-primary/60 hover:bg-muted/50',
        'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
        disabled ? 'pointer-events-none opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{m.documents_upload_pdf_only()}</span>
      <input
        ref={inputRef}
        id="documents-upload-input"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={onFileChange}
      />
    </label>
  );
}
