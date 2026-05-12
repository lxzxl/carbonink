import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Phase 1b — drag-drop upload zone for source PDFs.
 *
 * Two-step pipeline per drop:
 *   1. `document:upload` — write file, dedupe by sha256, return a Document row.
 *   2. `extraction:run` (stage `china_utility.v1`) — parse PDF text → LLM →
 *      `extraction` row with `status='review_needed'`.
 *
 * Phase 1c — when the PDF has no text layer, `extraction:run` falls back
 * to the vision path on the main side and sends an `extraction:progress`
 * event with `{ phase: 'vision' }`. This component subscribes for the
 * current document id and flips the spinner copy from "Extracting…" to
 * "Recognizing image (longer wait)…" so the user knows why the call is
 * taking 10x longer than usual.
 *
 * Status state machine for the visual progress label:
 *   idle → uploading → extracting (→ extracting:vision on progress event) → done → idle
 *
 * Disabled state covers all non-idle states. The progress subscription
 * is scoped to the active upload's document id so a stale "switched
 * to vision" event from a previous file doesn't sneak into the next
 * one.
 */
type UploadState = 'idle' | 'uploading' | 'extracting' | 'done';

const ACCEPT = 'application/pdf';
const STAGE_ID = 'china_utility.v1';

export function DocumentsUpload() {
  const [state, setState] = useState<UploadState>('idle');
  const [visionPhase, setVisionPhase] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  // Subscribe to extraction:progress for the current activeDocId. The
  // subscription is per-doc so a slow vision call doesn't leak its
  // phase event into a subsequent upload. We return the unsubscribe
  // directly from the effect so React cleans up on doc change or unmount.
  useEffect(() => {
    if (!activeDocId) return;
    const unsubscribe = subscribe('extraction:progress', (payload) => {
      if (payload.document_id === activeDocId && payload.phase === 'vision') {
        setVisionPhase(true);
      }
    });
    return unsubscribe;
  }, [activeDocId]);

  async function handleFile(file: File): Promise<void> {
    if (state !== 'idle') return;
    if (file.type !== ACCEPT) {
      toast.error(m.documents_upload_failed(), {
        description: m.documents_upload_pdf_only(),
      });
      return;
    }

    setState('uploading');
    setVisionPhase(false);
    let doc: Awaited<ReturnType<typeof documentApi.upload>>;
    try {
      const buffer = await file.arrayBuffer();
      doc = await documentApi.upload({
        filename: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(buffer),
      });
      toast.success(m.documents_upload_success(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
      setState('idle');
      return;
    }

    setActiveDocId(doc.id);
    setState('extracting');
    try {
      await extractionApi.run({ document_id: doc.id, stage_id: STAGE_ID });
      toast.success(m.documents_extraction_done(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', doc.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_extraction_failed(), { description: msg });
    } finally {
      setState('done');
      setTimeout(() => {
        setState('idle');
        setActiveDocId(null);
        setVisionPhase(false);
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
    e.target.value = '';
  }

  const disabled = state !== 'idle';
  const label =
    state === 'uploading'
      ? m.documents_uploading()
      : state === 'extracting'
        ? visionPhase
          ? m.documents_extracting_vision()
          : m.documents_extracting()
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
