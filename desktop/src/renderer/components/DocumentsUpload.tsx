import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import * as m from '@renderer/paraglide/messages';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * Phase 1b — drag-drop upload zone for source PDFs. Phase 2 — multi-file batch.
 *
 * Upload-only pipeline per file:
 *   1. `document:upload` — write file, dedupe by sha256, return a Document row.
 *      → Document appears in list with `doc_type=NULL` (shows as "未分类" chip).
 *
 * Classification and extraction are deferred to the review page (lazy).
 * This makes the upload flow provider-independent and fast.
 *
 * Batch behavior:
 *   - Accept multiple files at once (drag-drop OR file picker).
 *   - Non-PDFs are filtered out before any upload starts; one toast warns
 *     about the skipped count (we don't fail the whole batch).
 *   - Files upload sequentially. Sequential keeps the DB writes orderly
 *     and avoids racing the dedupe-by-sha256 check (parallel uploads of
 *     the same file would both compute the hash and both try to insert).
 *   - One failure in the middle does NOT abort the remaining uploads;
 *     errors are accumulated and reported in a single summary toast.
 *
 * Progress label states (in order):
 *   idle → uploading (with N/M counter) → done → idle
 */
type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; current: number; total: number; filename: string }
  | { kind: 'done' };

const ACCEPT = 'application/pdf';

export function DocumentsUpload() {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  async function handleFiles(filesIn: File[]): Promise<void> {
    if (state.kind !== 'idle') return;
    if (filesIn.length === 0) return;

    // Filter PDFs; warn if any were skipped.
    const pdfs = filesIn.filter((f) => f.type === ACCEPT);
    const skipped = filesIn.length - pdfs.length;
    if (skipped > 0) {
      toast.warning(m.documents_upload_pdf_only(), {
        description: `${skipped} non-PDF file(s) skipped`,
      });
    }
    if (pdfs.length === 0) return;

    const total = pdfs.length;
    const successes: string[] = [];
    const failures: { filename: string; message: string }[] = [];

    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      if (!file) continue;
      setState({ kind: 'uploading', current: i + 1, total, filename: file.name });
      try {
        const buffer = await file.arrayBuffer();
        await documentApi.upload({
          filename: file.name,
          mimeType: file.type,
          bytes: new Uint8Array(buffer),
        });
        successes.push(file.name);
      } catch (err) {
        // Per-file failure: capture the raw message for the batch
        // summary. The summary toast renders the list internally and
        // doesn't pipe `message` into a toast description, so keeping
        // the raw IPC string here is fine (the user only sees a count
        // + filenames, not the raw error).
        const failureMsg = err instanceof Error ? err.message : String(err);
        failures.push({ filename: file.name, message: failureMsg });
      }
    }

    // Refresh document list once at the end (avoids N invalidations on a batch).
    await queryClient.invalidateQueries({ queryKey: ['document:list'] });

    // Single summary toast for the batch.
    if (failures.length === 0) {
      toast.success(m.documents_upload_success(), {
        description: total === 1 ? successes[0] : `${successes.length} file(s) uploaded`,
      });
    } else if (successes.length === 0) {
      toast.error(m.documents_upload_failed(), {
        description: failures.map((f) => `${f.filename}: ${f.message}`).join('\n'),
      });
    } else {
      toast.warning(m.documents_upload_success(), {
        description: `${successes.length} ok, ${failures.length} failed`,
      });
    }

    setState({ kind: 'done' });
    setTimeout(() => setState({ kind: 'idle' }), 1200);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void handleFiles(files);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) void handleFiles(files);
    e.target.value = '';
  }

  const disabled = state.kind !== 'idle';
  const label =
    state.kind === 'uploading'
      ? `${m.documents_uploading()} (${state.current}/${state.total}) — ${state.filename}`
      : state.kind === 'done'
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
      data-state={state.kind}
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
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={onFileChange}
      />
    </label>
  );
}
