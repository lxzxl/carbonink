import { FilePreview } from '@renderer/components/FilePreview';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { auditApi } from '@renderer/lib/api/audit';
import { evidenceApi } from '@renderer/lib/api/evidence';
import { lineageApi } from '@renderer/lib/api/lineage';
import * as m from '@renderer/paraglide/messages';
import type {
  ActivityLineage,
  AuditEvent,
  EvidenceAttachmentWithDocument,
  LineageResult,
} from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  Download,
  FileText,
  MessageSquareText,
  Paperclip,
  PenLine,
  Rows3,
  Tag,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { Drawer } from 'vaul';

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** Mirrors EVIDENCE_MIME_TYPES in document-service.ts. */
const EVIDENCE_ACCEPT = '.pdf,.xlsx,.png,.jpg,.jpeg,.webp';

export interface LineageDrawerProps {
  entity: 'activity_data' | 'answer';
  /** Record id; `null` renders nothing (drawer closed). */
  id: string | null;
  onClose: () => void;
}

/**
 * 溯源 panel (audit-readiness spec 2026-07-11): one right-side drawer
 * answering the auditor's question "where did this number come from?" —
 * three calm sections top-to-bottom: the lineage chain (source →
 * record → pinned EF → downstream), the evidence attachments (add /
 * remove / inline preview), and the per-record audit timeline. Chain
 * leaves reuse the standing provenance idiom (muted line, primary link,
 * `?highlight=` deep-links) and navigating away closes the drawer.
 */
export function LineageDrawer({ entity, id, onClose }: LineageDrawerProps) {
  if (id === null) return null;
  return <LineageDrawerOpen entity={entity} id={id} onClose={onClose} />;
}

function LineageDrawerOpen({
  entity,
  id,
  onClose,
}: {
  entity: 'activity_data' | 'answer';
  id: string;
  onClose: () => void;
}) {
  const auditRef = entity === 'activity_data' ? { activity_data_id: id } : { answer_id: id };

  const lineageQuery = useQuery<LineageResult>({
    queryKey: ['lineage:get', entity, id],
    queryFn: () => lineageApi.get({ entity, id }),
  });
  const auditQuery = useQuery<AuditEvent[]>({
    queryKey: ['audit:list-by-record', auditRef],
    queryFn: () => auditApi.listByRecord(auditRef),
  });

  return (
    <Drawer.Root open={true} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[480px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.lineage_drawer_title()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label={m.lineage_drawer_close()}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 space-y-5 overflow-auto px-4 py-4">
            {lineageQuery.isLoading && (
              <p className="text-sm text-muted-foreground">{m.loading()}</p>
            )}
            {lineageQuery.isError && (
              <p className="text-sm text-destructive">{m.lineage_load_failed()}</p>
            )}
            {lineageQuery.data && (
              <>
                <section className="space-y-2">
                  <SectionHeading>{m.lineage_section_chain()}</SectionHeading>
                  {lineageQuery.data.entity === 'activity_data' ? (
                    <ActivityChain lineage={lineageQuery.data} onNavigate={onClose} />
                  ) : (
                    <AnswerChain lineage={lineageQuery.data} onNavigate={onClose} />
                  )}
                </section>

                <EvidenceSection
                  entity={entity}
                  id={id}
                  evidence={lineageQuery.data.evidence}
                  lineageKey={['lineage:get', entity, id]}
                />
              </>
            )}

            <section className="space-y-2">
              <SectionHeading>{m.lineage_section_history()}</SectionHeading>
              {auditQuery.data && auditQuery.data.length === 0 && (
                <p className="text-xs text-muted-foreground">{m.lineage_history_empty()}</p>
              )}
              <ul className="space-y-1">
                {(auditQuery.data ?? []).map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {e.occurred_at.slice(0, 16).replace('T', ' ')}
                    </span>
                    <span className="text-foreground">{kindLabel(e.event_kind)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

/**
 * One step in the vertical chain: icon + small label line + content.
 * Deliberately a flat list, not a graph canvas — calm density over
 * spectacle; the order top-to-bottom IS the data flow.
 */
function ChainNode({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-muted/40 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </li>
  );
}

function ActivityChain({
  lineage,
  onNavigate,
  embedded = false,
}: {
  lineage: ActivityLineage;
  onNavigate: () => void;
  embedded?: boolean;
}) {
  const a = lineage.activity;
  return (
    <ul className={`space-y-3 ${embedded ? 'border-l border-border/60 pl-3' : ''}`}>
      {/* 1. Origin */}
      {lineage.source.kind === 'document' && (
        <ChainNode icon={<FileText className="h-3 w-3" />} label={m.lineage_source_document()}>
          <Link
            to="/documents/$id"
            params={{ id: lineage.source.document_id }}
            onClick={onNavigate}
            className="text-primary hover:underline"
            title={lineage.source.filename}
          >
            {lineage.source.filename}
          </Link>
        </ChainNode>
      )}
      {lineage.source.kind === 'inbound' && (
        <ChainNode icon={<Download className="h-3 w-3" />} label={m.lineage_source_inbound()}>
          <Link
            to="/supplier-disclosures/$id"
            params={{ id: lineage.source.questionnaire_id }}
            onClick={onNavigate}
            className="text-primary hover:underline"
          >
            {lineage.source.supplier_name ?? lineage.source.questionnaire_id}
          </Link>
          {lineage.source.tier !== null && (
            <span className="ml-1.5 text-xs text-muted-foreground">Tier {lineage.source.tier}</span>
          )}
        </ChainNode>
      )}
      {lineage.source.kind === 'manual' && (
        <ChainNode icon={<PenLine className="h-3 w-3" />} label={m.lineage_source_manual()}>
          <span className="text-muted-foreground">{m.lineage_source_manual_hint()}</span>
        </ChainNode>
      )}

      {/* 2. The activity row itself */}
      <ChainNode icon={<Rows3 className="h-3 w-3" />} label={m.lineage_node_activity()}>
        <span className="font-medium">{lineage.emission_source_name}</span>
        <span className="ml-1.5 tabular-nums">
          {a.amount} {a.unit}
        </span>
        <span className="mx-1 text-muted-foreground">→</span>
        <span className="tabular-nums">{a.computed_co2e_kg} kg CO2e</span>
        {embedded && (
          <Link
            to="/activities"
            search={{ highlight: a.id }}
            onClick={onNavigate}
            className="ml-1.5 text-xs text-primary hover:underline"
          >
            {m.lineage_open_in_activities()}
          </Link>
        )}
      </ChainNode>

      {/* 3. Pinned emission factor */}
      <ChainNode icon={<Tag className="h-3 w-3" />} label={m.lineage_node_ef()}>
        {lineage.pinned_ef ? (
          <>
            <div className="font-mono text-xs">{lineage.pinned_ef.factor_code}</div>
            <div className="text-xs text-muted-foreground">
              {lineage.pinned_ef.source} · {lineage.pinned_ef.year} · {lineage.pinned_ef.geography}{' '}
              · {lineage.pinned_ef.dataset_version}
              <span className="mx-1">·</span>
              <span className="tabular-nums">
                {lineage.pinned_ef.co2e_kg_per_unit} kg/{lineage.pinned_ef.input_unit}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {m.lineage_ef_pinned_at({ date: lineage.pinned_ef.pinned_at.slice(0, 10) })}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </ChainNode>

      {/* 4. Downstream consumers */}
      {lineage.answers.length === 0 && lineage.snapshots.length === 0 ? (
        <ChainNode
          icon={<MessageSquareText className="h-3 w-3" />}
          label={m.lineage_node_downstream()}
        >
          <span className="text-muted-foreground">{m.lineage_no_downstream()}</span>
        </ChainNode>
      ) : (
        <>
          {lineage.answers.length > 0 && (
            <ChainNode
              icon={<MessageSquareText className="h-3 w-3" />}
              label={m.lineage_node_answers()}
            >
              <ul className="space-y-1">
                {lineage.answers.map((ans) => (
                  <li key={ans.answer_id} className="text-xs">
                    <Link
                      to="/questionnaires/$id"
                      params={{ id: ans.questionnaire_id }}
                      onClick={onNavigate}
                      className="text-primary hover:underline"
                      title={ans.question_text}
                    >
                      {ans.question_text}
                    </Link>
                    {ans.finalized_at && (
                      <span className="ml-1.5 text-muted-foreground">{m.answer_finalized()}</span>
                    )}
                  </li>
                ))}
              </ul>
            </ChainNode>
          )}
          {lineage.snapshots.length > 0 && (
            <ChainNode icon={<Archive className="h-3 w-3" />} label={m.lineage_node_snapshots()}>
              <ul className="space-y-0.5">
                {lineage.snapshots.map((s) => (
                  <li key={s.snapshot_id} className="text-xs text-muted-foreground">
                    {m.lineage_snapshot_revision({
                      revision: String(s.revision),
                      date: s.frozen_at.slice(0, 10),
                    })}
                  </li>
                ))}
              </ul>
            </ChainNode>
          )}
        </>
      )}
    </ul>
  );
}

function AnswerChain({
  lineage,
  onNavigate,
}: {
  lineage: Extract<LineageResult, { entity: 'answer' }>;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        <ChainNode
          icon={<MessageSquareText className="h-3 w-3" />}
          label={m.lineage_node_question()}
        >
          <div>{lineage.question_text}</div>
          <div className="text-xs text-muted-foreground">
            <Link
              to={
                lineage.questionnaire.direction === 'inbound'
                  ? '/supplier-disclosures/$id'
                  : '/questionnaires/$id'
              }
              params={{ id: lineage.questionnaire.id }}
              onClick={onNavigate}
              className="text-primary hover:underline"
            >
              {lineage.questionnaire.customer_name ?? lineage.questionnaire.id}
            </Link>
            <span className="mx-1">·</span>
            {lineage.questionnaire.reporting_year}
          </div>
        </ChainNode>
        <ChainNode icon={<PenLine className="h-3 w-3" />} label={m.lineage_node_answer()}>
          <span className="tabular-nums">{lineage.answer.value}</span>
          {lineage.answer.unit && <span className="ml-1">{lineage.answer.unit}</span>}
          <span className="ml-1.5 text-xs text-muted-foreground">
            {answerSourceKindLabel(lineage.answer.source_kind)}
          </span>
        </ChainNode>
      </ul>
      {lineage.source_activity && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {m.lineage_answer_upstream()}
          </div>
          <ActivityChain lineage={lineage.source_activity} onNavigate={onNavigate} embedded />
        </div>
      )}
    </div>
  );
}

function EvidenceSection({
  entity,
  id,
  evidence,
  lineageKey,
}: {
  entity: 'activity_data' | 'answer';
  id: string;
  evidence: EvidenceAttachmentWithDocument[];
  lineageKey: ReadonlyArray<string>;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const targetRef = entity === 'activity_data' ? { activity_data_id: id } : { answer_id: id };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: lineageKey });
    void queryClient.invalidateQueries({ queryKey: ['audit:list-by-record'] });
  };

  const add = useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer();
      return evidenceApi.add({
        ...targetRef,
        filename: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(buf),
      });
    },
    onSuccess: invalidate,
    onError: (e) =>
      toast.error(`${m.evidence_add_failed()}: ${e instanceof Error ? e.message : String(e)}`),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => evidenceApi.remove({ id: attachmentId }),
    onSuccess: () => {
      setPreviewId(null);
      invalidate();
    },
    onError: (e) =>
      toast.error(`${m.evidence_remove_failed()}: ${e instanceof Error ? e.message : String(e)}`),
  });

  const previewed = evidence.find((ev) => ev.id === previewId);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionHeading>{m.lineage_section_evidence()}</SectionHeading>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={add.isPending}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          {add.isPending ? m.evidence_adding() : m.evidence_add_button()}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={EVIDENCE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) add.mutate(file);
            e.target.value = '';
          }}
        />
      </div>

      {evidence.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.evidence_empty()}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {evidence.map((ev) => (
            <li key={ev.id} className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setPreviewId(previewId === ev.id ? null : ev.id)}
                className="min-w-0 flex-1 text-left"
                title={ev.filename}
              >
                <div className="truncate text-sm text-foreground">{ev.filename}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{(ev.size_bytes / 1024).toFixed(1)} KB</span>
                  <span className="mx-1">·</span>
                  {ev.created_at.slice(0, 10)}
                  {ev.note && (
                    <>
                      <span className="mx-1">·</span>
                      <span title={ev.note}>{ev.note}</span>
                    </>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(ev.id)}
                disabled={remove.isPending}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                aria-label={m.evidence_remove_button()}
                title={m.evidence_remove_button()}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {previewed && (
        <div className="h-64">
          <FilePreview documentId={previewed.document_id} mimeType={previewed.mime_type} />
        </div>
      )}
    </section>
  );
}

/**
 * Kind → human label. Explicit switch (not dynamic key lookup) because
 * paraglide messages are plain functions; unknown kinds fall back to the
 * raw kind string so new event types degrade legibly.
 */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'activity_data.created':
      return m.audit_event_kind_activity_data_created();
    case 'activity_data.deleted':
      return m.audit_event_kind_activity_data_deleted();
    case 'activity_rebind_ef':
      return m.audit_event_kind_activity_rebind_ef();
    case 'evidence.attached':
      return m.audit_event_kind_evidence_attached();
    case 'evidence.removed':
      return m.audit_event_kind_evidence_removed();
    default:
      return kind;
  }
}

function answerSourceKindLabel(kind: string): string {
  switch (kind) {
    case 'mapped_inventory':
      return m.lineage_answer_kind_mapped();
    case 'manual':
      return m.lineage_answer_kind_manual();
    case 'ai_suggested':
      return m.lineage_answer_kind_ai();
    case 'reused':
      return m.answer_source_reused();
    default:
      return kind;
  }
}
