/**
 * Shared overdue arithmetic for inbound supplier disclosures.
 *
 * One definition, three consumers — the /supplier-disclosures list
 * (chip + row badge), the sidebar nav badge, and the detail header —
 * so "what counts as overdue" can't drift between surfaces. The main
 * process's launch notification mirrors the same predicate in SQL
 * (overdue-notify-service.ts); keep the two in sync.
 */

/**
 * Local-timezone YYYY-MM-DD. `due_date` is a bare date, so comparing
 * against a UTC-derived "today" would flag rows as overdue a few hours
 * early (or late) for anyone east of Greenwich — sv-SE locale happens to
 * format exactly as ISO date.
 */
export function localToday(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/**
 * Overdue = the ball is in the supplier's court past the deadline:
 * sent, has a due date, and that date is behind us. `received` past due
 * is NOT overdue — the pending work (ingest) is ours, and the existing
 * status chip already surfaces it.
 */
export function isOverdue(
  row: { status: string; due_date: string | null },
  today: string,
): boolean {
  return row.status === 'sent' && row.due_date !== null && row.due_date < today;
}

export function overdueDays(dueDate: string, today: string): number {
  const ms = new Date(`${today}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}
