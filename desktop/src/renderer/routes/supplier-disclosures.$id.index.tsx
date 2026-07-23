import { InboundQuestionTable } from '@renderer/components/inbound/InboundQuestionTable';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { answerApi } from '@renderer/lib/api/answer';
import { inboundQuestionnaireApi } from '@renderer/lib/api/inbound-questionnaire';
import { orgApi } from '@renderer/lib/api/organization';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import { supplierApi } from '@renderer/lib/api/supplier';
import { isOverdue, localToday, overdueDays } from '@renderer/lib/inbound-overdue';
import { buildReminderMailto } from '@renderer/lib/reminder-mailto';
import * as m from '@renderer/paraglide/messages';
import type { Question, Questionnaire } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, Mail, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * `/supplier-disclosures/$id` — inbound supplier-disclosure detail.
 *
 * Status-driven action bar drives the user through the
 * supplier-disclosure lifecycle:
 *   draft     → [Export blank xlsx]
 *   sent      → [Re-export] [Import filled xlsx]
 *   received  → [Review and ingest]
 *   ingested  → [View linked activities]
 *
 * Body shows the question list with tier badges + a status-conditional
 * hint banner explaining the next step. No AnswerReviewCard — inbound
 * answers come from the supplier via import, not from user typing.
 *
 * Note: this route only handles direction='inbound' rows. Outbound rows
 * live under `/questionnaires/$id` and have a completely different
 * action bar (AI generate, finalize, export-to-customer).
 */
export const Route = createFileRoute('/supplier-disclosures/$id/')({
  component: SupplierDisclosureDetailRoute,
});

function SupplierDisclosureDetailRoute(): JSX.Element {
  const { id } = Route.useParams();

  const q = useQuery({
    queryKey: ['questionnaire:get-by-id', id],
    queryFn: () => questionnaireApi.getById({ id }),
  });

  if (q.isLoading) return <p className="p-6 text-muted-foreground">{m.loading()}</p>;
  if (!q.data) {
    return (
      <div className="space-y-4 p-6">
        <Link to="/supplier-disclosures" className="text-sm text-primary hover:underline">
          {m.inbound_back_to_list()}
        </Link>
        <p className="text-destructive">{m.inbound_not_found()}</p>
      </div>
    );
  }
  const { questionnaire, customer, questions } = q.data;

  // Defense in depth: a stale URL to an outbound questionnaire under
  // this route shouldn't render the inbound action bar. Redirect-feel
  // banner steers the user to the right place.
  if (questionnaire.direction !== 'inbound') {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-destructive">{m.inbound_wrong_direction()}</p>
        <Link
          to="/questionnaires/$id"
          params={{ id }}
          className="text-sm text-primary hover:underline"
        >
          {m.inbound_goto_outbound()}
        </Link>
      </div>
    );
  }

  return (
    <InboundDetailBody
      id={id}
      questionnaire={questionnaire}
      supplier={customer}
      questions={questions}
    />
  );
}

function InboundDetailBody({
  id,
  questionnaire,
  supplier,
  questions,
}: {
  id: string;
  questionnaire: Questionnaire;
  supplier: { id: string; name: string; email: string | null };
  questions: Question[];
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Once the supplier's reply is imported (status='received') or ingested,
  // surface the captured values inline on this page. Without this, the
  // detail page shows only the bare question list after a successful
  // import — which reads as "no answers were recognized" even though the
  // import worked. The dedicated /ingest page is still where accept/reject
  // happens; this is just a read-only echo so the import result is visible.
  const showAnswers = questionnaire.status === 'received' || questionnaire.status === 'ingested';
  const answersQuery = useQuery({
    queryKey: ['answer:list-by-questionnaire', id],
    queryFn: () => answerApi.listByQuestionnaire(id),
    enabled: showAnswers,
  });
  const answersByQuestionId = useMemo(() => {
    const m = new Map<string, { value: string; unit: string | null; note: string }>();
    for (const a of answersQuery.data ?? []) {
      m.set(a.question_id, { value: a.value, unit: a.unit, note: parseNote(a.source_summary) });
    }
    return m;
  }, [answersQuery.data]);

  const exportMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.exportXlsx({ questionnaire_id: id }),
    onSuccess: (r) => {
      if (r.canceled) return;
      toast.success(m.inbound_export_success({ path: r.path, bytes: String(r.bytes_written) }));
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const importMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.importPreview({ questionnaire_id: id }),
    onSuccess: (r) => {
      if (r.canceled) return;
      if ('error' in r) {
        toast.error(m.inbound_import_failed(), { description: r.error.message });
        return;
      }
      toast.success(
        m.inbound_import_parsed({
          count: String(r.preview.answers.filter((a) => !a.is_blank).length),
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      void queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', id] });
      void navigate({ to: '/supplier-disclosures/$id/ingest', params: { id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // 催办邮件 (spec 2026-07-13): compose a reminder draft in the OS mail
  // client. Needs the supplier's email — when missing, a small dialog
  // collects + persists it first, then composes with the fresh address.
  const today = localToday();
  const overdue = isOverdue(questionnaire, today);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  // fetchQuery (not a render-time useQuery) so a click right after mount
  // can't race the org load and silently drop the sign-off; failure just
  // omits the signature.
  const openReminder = async (email: string): Promise<void> => {
    const org = await queryClient
      .fetchQuery({ queryKey: ['org:get-current'], queryFn: () => orgApi.getCurrent() })
      .catch(() => null);
    window.open(
      buildReminderMailto({
        email,
        supplierName: supplier.name,
        reportingYear: questionnaire.reporting_year,
        dueDate: questionnaire.due_date,
        daysOverdue:
          overdue && questionnaire.due_date !== null
            ? overdueDays(questionnaire.due_date, today)
            : null,
        orgName: org?.name_zh ?? org?.name_en ?? null,
      }),
    );
  };

  const setEmailMutation = useMutation({
    mutationFn: (email: string) => supplierApi.setEmail({ id: supplier.id, email }),
    onSuccess: (updated) => {
      setEmailDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
      void queryClient.invalidateQueries({ queryKey: ['supplier:list'] });
      const email = updated?.email;
      if (email) void openReminder(email);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const handleRemind = (): void => {
    if (supplier.email) {
      void openReminder(supplier.email);
    } else {
      setEmailInput('');
      setEmailDialogOpen(true);
    }
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => inboundQuestionnaireApi.delete({ questionnaire_id: id }),
    onSuccess: (r) => {
      setConfirmDeleteOpen(false);
      toast.success(
        r.deleted_activity_data > 0
          ? m.inbound_delete_success_with_activities({
              count: String(r.deleted_activity_data),
            })
          : m.inbound_delete_success(),
      );
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      void queryClient.invalidateQueries({ queryKey: ['activity:list-by-period'] });
      void navigate({ to: '/supplier-disclosures' });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 px-6 pt-6 pb-3">
        <h1 className="text-2xl font-semibold">{supplier.name}</h1>
        <p className="text-sm text-muted-foreground">
          {questionnaire.reporting_year} · {statusLabel(questionnaire.status)} · Cat 1 Supplier
          Disclosure · {m.inbound_question_count({ count: String(questions.length) })}
          {questionnaire.due_date && (
            <>
              {' · '}
              {overdue ? (
                <span className="font-medium text-destructive">
                  {m.inbound_overdue_days({
                    days: String(overdueDays(questionnaire.due_date, today)),
                  })}
                </span>
              ) : (
                m.inbound_due_on({ date: questionnaire.due_date })
              )}
            </>
          )}
        </p>
        {supplier.email && (
          <p className="text-xs text-muted-foreground">
            {supplier.email}
            <button
              type="button"
              onClick={() => {
                setEmailInput(supplier.email ?? '');
                setEmailDialogOpen(true);
              }}
              className="ml-2 rounded px-1 py-0.5 font-medium text-foreground/70 hover:bg-foreground/5"
            >
              {m.inbound_remind_email_edit()}
            </button>
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-3 space-y-4">
        <InboundQuestionTable
          questions={questions}
          {...(showAnswers ? { answersByQuestionId } : {})}
        />
        <StatusHint status={questionnaire.status} />
      </div>

      <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
        {/* Destructive delete sits apart on the left so it's never adjacent
            to the primary forward action. Available in every status. */}
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          {m.inbound_delete_button()}
        </Button>

        <div className="flex items-center gap-2">
          {questionnaire.status === 'draft' && (
            <Button
              type="button"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {exportMutation.isPending ? m.inbound_exporting() : m.inbound_export_blank()}
            </Button>
          )}
          {questionnaire.status === 'sent' && (
            <>
              <Button type="button" variant="outline" onClick={handleRemind}>
                <Mail className="mr-1.5 h-4 w-4" />
                {m.inbound_remind_button()}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                {m.inbound_reexport()}
              </Button>
              <Button
                type="button"
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                {importMutation.isPending ? m.inbound_importing() : m.inbound_import_filled()}
              </Button>
            </>
          )}
          {questionnaire.status === 'received' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                {importMutation.isPending ? m.inbound_importing() : m.inbound_reimport_filled()}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void navigate({ to: '/supplier-disclosures/$id/ingest', params: { id } })
                }
              >
                {m.inbound_review_ingest()}
              </Button>
            </>
          )}
          {questionnaire.status === 'ingested' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigate({ to: '/activities' })}
            >
              {m.inbound_view_activities()}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.inbound_remind_email_dialog_title()}</DialogTitle>
            <DialogDescription>{m.inbound_remind_email_dialog_desc()}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="supplier-email-input">{m.inbound_remind_email_label()}</Label>
            <Input
              id="supplier-email-input"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="esg@example.com"
              disabled={setEmailMutation.isPending}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEmailDialogOpen(false)}
              disabled={setEmailMutation.isPending}
            >
              {m.cancel()}
            </Button>
            <Button
              type="button"
              onClick={() => setEmailMutation.mutate(emailInput.trim())}
              disabled={emailInput.trim() === '' || setEmailMutation.isPending}
            >
              {m.inbound_remind_email_save()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.inbound_delete_dialog_title()}</DialogTitle>
            <DialogDescription>
              {m.inbound_delete_dialog_desc({ name: supplier.name })}
              {questionnaire.status === 'ingested' ? m.inbound_delete_dialog_ingested_extra() : ''}
              {m.inbound_delete_dialog_irreversible()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              {m.cancel()}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? m.inbound_deleting() : m.inbound_delete_confirm()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Pull the supplier's note out of an inbound answer's `source_summary`
 * JSON (`{source, tier, position, note?}`). Returns '' on null / invalid
 * JSON / absent note — the echo just shows no note in that case.
 */
function parseNote(sourceSummary: string | null): string {
  if (!sourceSummary) return '';
  try {
    const parsed = JSON.parse(sourceSummary) as { note?: unknown };
    return typeof parsed.note === 'string' ? parsed.note : '';
  } catch {
    return '';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return m.inbound_detail_status_draft();
    case 'sent':
      return m.inbound_detail_status_sent();
    case 'received':
      return m.inbound_detail_status_received();
    case 'ingested':
      return m.inbound_detail_status_ingested();
    default:
      return status;
  }
}

function StatusHint({ status }: { status: string }): JSX.Element | null {
  const hints: Record<string, string> = {
    draft: m.inbound_hint_draft(),
    sent: m.inbound_hint_sent(),
    received: m.inbound_hint_received(),
    ingested: m.inbound_hint_ingested(),
  };
  const text = hints[status];
  if (!text) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {text}
    </div>
  );
}
