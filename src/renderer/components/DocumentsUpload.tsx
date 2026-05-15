import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import * as m from '@renderer/paraglide/messages';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * Phase 1b — drag-drop upload zone for source PDFs.
 *
 * Upload-only pipeline per drop:
 *   1. `document:upload` — write file, dedupe by sha256, return a Document row.
 *      → Document appears in list with `doc_type=NULL` (shows as "未分类" chip on T6).
 *
 * Classification and extraction are deferred to the review page (T7).
 * This makes the upload flow provider-independent and faster.
 *
 * Status state machine for the visual progress label:
 *   idle → uploading → done → idle
 *
 * Disabled state covers non-idle states. The upload zone remains enabled
 * even when a file is being processed so users can queue multiple uploads.
 */
type UploadState = 'idle' | 'uploading' | 'done';

const ACCEPT = 'application/pdf';

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
    try {
      const buffer = await file.arrayBuffer();
      await documentApi.upload({
        filename: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(buffer),
      });
      toast.success(m.documents_upload_success(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
    } finally {
      setState('done');
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
    e.target.value = '';
  }

  const disabled = state !== 'idle';
  const label =
    state === 'uploading'
      ? m.documents_uploading()
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
