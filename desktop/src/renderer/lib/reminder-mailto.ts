import * as m from '@renderer/paraglide/messages';

/**
 * Compose the 催办 (reminder) mailto: URL for an inbound supplier
 * disclosure. Pure string assembly — the caller hands it to
 * `window.open`, which Electron's setWindowOpenHandler forwards to
 * `shell.openExternal`, landing in the OS default mail client with a
 * pre-filled draft. Deliberately mailto instead of SMTP: the whole
 * inbound flow is an email round-trip the consultant already owns, and
 * zero-infrastructure is the point (供应商零账户叙事).
 */
export interface ReminderMailtoInput {
  email: string;
  supplierName: string;
  reportingYear: number;
  /** Bare YYYY-MM-DD, or null when the disclosure has no deadline. */
  dueDate: string | null;
  /** Days past due; null when not (yet) overdue. */
  daysOverdue: number | null;
  /** Sender org for the sign-off; omitted from the body when null. */
  orgName: string | null;
}

export function buildReminderMailto(input: ReminderMailtoInput): string {
  const year = String(input.reportingYear);
  const subject = m.inbound_remind_mail_subject({ year, supplier: input.supplierName });

  const lines: string[] = [
    m.inbound_remind_mail_greeting({ supplier: input.supplierName }),
    m.inbound_remind_mail_sent_line({ year }),
  ];
  if (input.dueDate !== null && input.daysOverdue !== null) {
    lines.push(
      m.inbound_remind_mail_overdue_line({
        due: input.dueDate,
        days: String(input.daysOverdue),
      }),
    );
  } else if (input.dueDate !== null) {
    lines.push(m.inbound_remind_mail_due_line({ due: input.dueDate }));
  }
  lines.push(m.inbound_remind_mail_ask_line());
  if (input.orgName) {
    lines.push(m.inbound_remind_mail_signoff({ org: input.orgName }));
  }

  const body = lines.join('\n\n');
  return `mailto:${encodeURIComponent(input.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
