import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, RotateCw, Sparkles, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * Compact drag-drop affordance embedded inside the "add activity"
 * drawer. Uploads a single PDF, kicks off the existing classify +
 * extract pipeline, and surfaces the resulting Extraction to the
 * parent so it can prefill the ActivityForm fields.
 *
 * Stage flow (status visible in the UI):
 *   idle   → uploading → classifying → done(extraction)  ✔ → parent prefills
 *                                    ↘ failed (toast, keep idle)
 *
 * Differences vs the full `/documents` upload zone:
 *  - Single file only (drawer scope is one activity).
 *  - Auto-classify + extract chained after upload (the /documents
 *    flow defers classification to the review page).
 *  - On success, the dropzone shrinks to a small "已识别 X.pdf ⟳"
 *    pill so the form below has room — re-uploading restores the
 *    full dropzone.
 *
 * Reuses the same `documentApi.upload` + `extractionApi.classifyAndRun`
 * IPC channels the /documents flow uses; no new backend needed.
 */

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'classifying'; filename: string }
  | { kind: 'done'; filename: string };

const ACCEPT = 'application/pdf';

export interface ActivityDocumentDropzoneProps {
  /**
   * Fires after the extraction is parsed. Parent uses `extraction.id`
   * + `extraction.parsed_json` + `extraction.prompt_version` to build
   * ActivityForm initialValues via the existing per-stage
   * `buildXxxInitialValues` helpers.
   */
  onParsed: (payload: { extraction: Extraction; document: Document }) => void;
  /** Optional reset signal — parent calls when the drawer closes. */
  onReset?: () => void;
}

export function ActivityDocumentDropzone({ onParsed }: ActivityDocumentDropzoneProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      file.arrayBuffer().then((buffer) =>
        documentApi.upload({
          filename: file.name,
          mimeType: file.type,
          bytes: new Uint8Array(buffer),
        }),
      ),
  });

  const classifyMutation = useMutation({
    mutationFn: (document_id: string) => extractionApi.classifyAndRun({ document_id }),
  });

  async function handleFile(file: File): Promise<void> {
    if (file.type !== ACCEPT) {
      toast.warning(m.documents_upload_pdf_only());
      return;
    }

    setState({ kind: 'uploading', filename: file.name });
    let uploadedDoc: Document;
    try {
      uploadedDoc = await uploadMutation.mutateAsync(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
      setState({ kind: 'idle' });
      return;
    }

    // Tell the rest of the app a new doc landed (the docs list query
    // caches will refetch on next mount — important so the linked-doc
    // preview drawer on /activities can resolve the filename).
    await queryClient.invalidateQueries({ queryKey: ['document:list'] });

    setState({ kind: 'classifying', filename: uploadedDoc.filename });
    try {
      const result = await classifyMutation.mutateAsync(uploadedDoc.id);
      if (result.status === 'classify_failed') {
        toast.error(m.activity_doc_classify_failed_title(), {
          description: m.activity_doc_classify_failed_body(),
        });
        setState({ kind: 'idle' });
        return;
      }
      // status === 'classified' — we have an extraction. Surface it to
      // the parent, which will rebuild ActivityForm with prefilled
      // fields + matcherHint.
      setState({ kind: 'done', filename: uploadedDoc.filename });
      onParsed({ extraction: result.extraction, document: uploadedDoc });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.activity_doc_classify_failed_title(), { description: msg });
      setState({ kind: 'idle' });
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

  function reset(): void {
    setState({ kind: 'idle' });
  }

  // Compact "已识别" pill after success — the parent has already
  // prefilled the form, so the dropzone shouldn't keep claiming a big
  // chunk of vertical space. Click ⟳ to upload a different doc.
  if (state.kind === 'done') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <FileText className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <span className="truncate" title={state.filename}>
            {state.filename}
          </span>
          <span className="shrink-0 text-xs text-emerald-700/80 dark:text-emerald-400/80">
            · {m.activity_doc_recognized()}
          </span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reset} className="shrink-0 gap-1">
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {m.activity_doc_reupload()}
        </Button>
      </div>
    );
  }

  const isBusy = state.kind === 'uploading' || state.kind === 'classifying';
  const label =
    state.kind === 'uploading'
      ? `${m.activity_doc_uploading()} — ${state.filename}`
      : state.kind === 'classifying'
        ? `${m.activity_doc_classifying()} — ${state.filename}`
        : m.activity_doc_hint();

  return (
    <label
      htmlFor="activity-doc-upload"
      onDragOver={(e) => {
        e.preventDefault();
        if (!isBusy) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      data-state={state.kind}
      data-dragging={isDragging || undefined}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm transition-colors',
        'hover:border-primary/60 hover:bg-muted/50',
        'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
        isBusy && 'pointer-events-none opacity-70',
      )}
    >
      {isBusy ? (
        <Sparkles className="h-5 w-5 shrink-0 text-primary animate-pulse" aria-hidden="true" />
      ) : (
        <UploadCloud className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{label}</div>
        {!isBusy && <div className="text-xs text-muted-foreground">{m.activity_doc_subhint()}</div>}
      </div>
      <input
        ref={inputRef}
        id="activity-doc-upload"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={isBusy}
        onChange={onFileChange}
      />
    </label>
  );
}
