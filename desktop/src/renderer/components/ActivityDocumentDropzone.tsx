import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, RotateCw, Sparkles, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  | { kind: 'uploading'; filename: string; startedAt: number }
  | { kind: 'classifying'; filename: string; startedAt: number }
  | { kind: 'done'; filename: string };

const ACCEPT = 'application/pdf';

/**
 * Hard timeout for the classify+extract pipeline. Two LLM calls run
 * back-to-back on the backend (classify doc_type → extract fields),
 * each taking 5–20 s in normal conditions, so a 90-second budget
 * covers cold-start providers but still catches genuine hangs (e.g.
 * provider unreachable, rate-limited). When the timeout fires we
 * reset the dropzone with a clear error — the backend will still
 * eventually complete the work (no abort signal threading through IPC
 * today), and the user can refresh /documents to see the extraction
 * if they want it.
 */
const CLASSIFY_TIMEOUT_MS = 90_000;

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
  const [elapsedSec, setElapsedSec] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Bumped whenever the user clicks Cancel — async handlers compare
  // against the captured snapshot at start; mismatch = stale request
  // whose results should be discarded.
  const runIdRef = useRef(0);

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

  // Tick the elapsed counter every 1 s while a request is in flight so
  // the user sees the wait isn't frozen — LLM round-trips routinely
  // run 20–40 s and a static label looks indistinguishable from "hung".
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.kind is the gate; deeper props (filename etc.) shouldn't restart the timer.
  useEffect(() => {
    if (state.kind !== 'uploading' && state.kind !== 'classifying') {
      setElapsedSec(0);
      return;
    }
    const startedAt = state.startedAt;
    setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const interval = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [state.kind]);

  function cancel(): void {
    runIdRef.current += 1; // any in-flight handler will see a stale runId
    setState({ kind: 'idle' });
    toast.info(m.activity_doc_canceled());
  }

  async function handleFile(file: File): Promise<void> {
    if (file.type !== ACCEPT) {
      toast.warning(m.documents_upload_pdf_only());
      return;
    }

    const myRunId = ++runIdRef.current;
    const isStale = () => runIdRef.current !== myRunId;

    setState({ kind: 'uploading', filename: file.name, startedAt: Date.now() });
    let uploadedDoc: Document;
    try {
      uploadedDoc = await uploadMutation.mutateAsync(file);
    } catch (err) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
      setState({ kind: 'idle' });
      return;
    }
    if (isStale()) return;

    await queryClient.invalidateQueries({ queryKey: ['document:list'] });

    setState({ kind: 'classifying', filename: uploadedDoc.filename, startedAt: Date.now() });

    // Promise.race the IPC call against a 90 s timeout so a hung
    // backend doesn't strand the user on the spinner forever. Note:
    // the backend has no abort hook today, so the timeout only frees
    // the UI — the LLM work eventually completes and the extraction
    // will be visible in /documents/$id.
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error('CLASSIFY_TIMEOUT'));
      }, CLASSIFY_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        classifyMutation.mutateAsync(uploadedDoc.id),
        timeoutPromise,
      ]);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (isStale()) return;

      if (result.status === 'classify_failed') {
        toast.error(m.activity_doc_classify_failed_title(), {
          description: m.activity_doc_classify_failed_body(),
        });
        setState({ kind: 'idle' });
        return;
      }
      setState({ kind: 'done', filename: uploadedDoc.filename });
      onParsed({ extraction: result.extraction, document: uploadedDoc });
    } catch (err) {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'CLASSIFY_TIMEOUT') {
        toast.error(m.activity_doc_classify_timeout_title(), {
          description: m.activity_doc_classify_timeout_body(),
        });
      } else {
        toast.error(m.activity_doc_classify_failed_title(), { description: msg });
      }
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

  // Busy state is a flat row (not a dashed dropzone) — it carries an
  // explicit Cancel button + elapsed counter so a stuck job has a
  // clear escape, and an "通常 30-60 秒" hint so users don't read the
  // wait as a hang.
  if (isBusy) {
    const label =
      state.kind === 'uploading' ? m.activity_doc_uploading() : m.activity_doc_classifying();
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
        <Sparkles className="h-5 w-5 shrink-0 text-primary animate-pulse" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">{label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{elapsedSec}s</span>
          </div>
          <div className="truncate text-xs text-muted-foreground" title={state.filename}>
            {state.filename}
            <span className="ml-2 text-muted-foreground/80">
              · {m.activity_doc_classify_hint_duration()}
            </span>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} className="shrink-0 gap-1">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {m.activity_doc_cancel()}
        </Button>
      </div>
    );
  }

  return (
    <label
      htmlFor="activity-doc-upload"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      data-state={state.kind}
      data-dragging={isDragging || undefined}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm transition-colors',
        'hover:border-primary/60 hover:bg-muted/50',
        'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
      )}
    >
      <UploadCloud className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{m.activity_doc_hint()}</div>
        <div className="text-xs text-muted-foreground">{m.activity_doc_subhint()}</div>
      </div>
      <input
        ref={inputRef}
        id="activity-doc-upload"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={onFileChange}
      />
    </label>
  );
}
