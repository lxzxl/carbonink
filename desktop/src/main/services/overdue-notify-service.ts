import { createMainWindow, getMainWindow } from '@main/window.js';
import type { Database } from 'better-sqlite3';
import { Notification } from 'electron';

/**
 * Launch-time overdue nudge for inbound supplier disclosures
 * (spec 2026-07-13-inbound-overdue-reminders, ROADMAP §8.1-⑤ v2).
 *
 * One aggregate OS notification per local calendar day, fired once at
 * startup — deliberately NOT a resident timer. The xlsx round-trip is
 * measured in days, so "you have overdue disclosures" only needs to
 * reach the user when they sit down, and a daily cap keeps the OS
 * notification a signal instead of a nag.
 *
 * The overdue predicate mirrors `renderer/lib/inbound-overdue.ts`
 * (sent + due_date < local today; `received` past due is our own
 * pending ingest, not the supplier's lateness) — keep the two in sync.
 *
 * Strings are inline Chinese by design: the paraglide locale lives in
 * renderer localStorage where main can't read it, and the surface this
 * deep-links to (供应商披露) is the v2.0 inline-Chinese area. Same
 * acknowledged i18n debt, not a new pattern.
 */

const LAST_NOTIFIED_SETTING = 'overdue_notify.last_notified_date';

/** Local-timezone YYYY-MM-DD (sv-SE formats as ISO date). */
export function localTodayMain(): string {
  return new Date().toLocaleDateString('sv-SE');
}

export interface OverdueNotifyResult {
  notified: boolean;
  count: number;
}

/**
 * Check for overdue inbound disclosures and, at most once per local day,
 * raise one aggregate system notification. Clicking it focuses (or
 * recreates) the main window and deep-links to /supplier-disclosures.
 * Safe to call on every launch; no-ops when unsupported, already
 * notified today, or nothing is overdue.
 */
export function notifyOverdueDisclosures(
  db: Database,
  today: string = localTodayMain(),
): OverdueNotifyResult {
  if (!Notification.isSupported()) return { notified: false, count: 0 };

  const last = db.prepare(`SELECT value FROM setting WHERE key = ?`).get(LAST_NOTIFIED_SETTING) as
    | { value: string }
    | undefined;
  if (last?.value === today) return { notified: false, count: 0 };

  const rows = db
    .prepare(
      `SELECT c.name AS supplier_name
         FROM questionnaire q
         JOIN customer c ON c.id = q.customer_id
        WHERE q.direction = 'inbound'
          AND q.status = 'sent'
          AND q.due_date IS NOT NULL
          AND q.due_date < ?
        ORDER BY q.due_date ASC, c.name ASC`,
    )
    .all(today) as Array<{ supplier_name: string }>;
  if (rows.length === 0) return { notified: false, count: 0 };

  const named = rows
    .slice(0, 2)
    .map((r) => `「${r.supplier_name}」`)
    .join('、');
  const body =
    rows.length <= 2
      ? `${named}的披露已过截止日期，点击查看。`
      : `${named}等 ${rows.length} 份披露已过截止日期，点击查看。`;

  const notification = new Notification({ title: '供应商披露逾期', body });
  notification.on('click', () => openSupplierDisclosures());
  notification.show();

  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(LAST_NOTIFIED_SETTING, today, new Date().toISOString());

  return { notified: true, count: rows.length };
}

/**
 * Focus (or recreate) the main window, then deep-link the renderer to
 * /supplier-disclosures via the `app:navigate` push channel.
 *
 * A freshly created window hasn't mounted the renderer's subscriber yet,
 * so the push waits for `did-finish-load` plus a beat for React to mount.
 * If the send still races the subscription the failure is soft — the
 * window is focused and the sidebar badge points the same way.
 */
function openSupplierDisclosures(): void {
  const existing = getMainWindow();
  const win = existing ?? createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  const send = (): void => {
    win.webContents.send('app:navigate', '/supplier-disclosures');
  };
  if (existing && !win.webContents.isLoading()) {
    send();
  } else {
    win.webContents.once('did-finish-load', () => {
      setTimeout(send, 500);
    });
  }
}
