import { randomUUID } from 'node:crypto';
import { runMigrations } from '@main/db/migrate';
import { notifyOverdueDisclosures } from '@main/services/overdue-notify-service';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hand-rolled electron fakes via vi.hoisted (vi.fn isn't available inside
 * the hoisted factory) — the service touches `Notification` (static
 * isSupported + instance on/show) and `@main/window.js` (focus-or-create
 * on notification click).
 */
const H = vi.hoisted(() => {
  type FakeWin = {
    minimized: boolean;
    restored: boolean;
    shown: number;
    focused: number;
    sent: Array<{ channel: string; payload: unknown }>;
    loadHandlers: Array<() => void>;
    loading: boolean;
    isMinimized: () => boolean;
    restore: () => void;
    show: () => void;
    focus: () => void;
    webContents: {
      isLoading: () => boolean;
      send: (channel: string, payload: unknown) => void;
      once: (event: string, cb: () => void) => void;
    };
  };
  function makeWin(loading: boolean): FakeWin {
    const w: FakeWin = {
      minimized: false,
      restored: false,
      shown: 0,
      focused: 0,
      sent: [],
      loadHandlers: [],
      loading,
      isMinimized: () => w.minimized,
      restore: () => {
        w.restored = true;
      },
      show: () => {
        w.shown += 1;
      },
      focus: () => {
        w.focused += 1;
      },
      webContents: {
        isLoading: () => w.loading,
        send: (channel, payload) => {
          w.sent.push({ channel, payload });
        },
        once: (_event, cb) => {
          w.loadHandlers.push(cb);
        },
      },
    };
    return w;
  }

  class FakeNotification {
    static supported = true;
    static instances: FakeNotification[] = [];
    opts: { title: string; body: string };
    clicks: Array<() => void> = [];
    didShow = false;
    constructor(opts: { title: string; body: string }) {
      this.opts = opts;
      FakeNotification.instances.push(this);
    }
    static isSupported(): boolean {
      return FakeNotification.supported;
    }
    on(_event: 'click', cb: () => void): this {
      this.clicks.push(cb);
      return this;
    }
    show(): void {
      this.didShow = true;
    }
  }

  const state = { win: null as FakeWin | null, created: 0 };
  return { state, makeWin, FakeNotification };
});

vi.mock('electron', () => ({ Notification: H.FakeNotification }));
vi.mock('@main/window.js', () => ({
  getMainWindow: () => H.state.win,
  createMainWindow: () => {
    H.state.created += 1;
    H.state.win = H.makeWin(true);
    return H.state.win;
  },
}));

const TODAY = '2026-07-13';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function seedDisclosure(
  db: InstanceType<typeof Database>,
  opts: { name: string; due: string | null; status?: string; direction?: string },
): void {
  const customerId = randomUUID();
  db.prepare(`INSERT INTO customer (id, name, notes, role) VALUES (?, ?, NULL, 'supplier')`).run(
    customerId,
    opts.name,
  );
  db.prepare(
    `INSERT INTO questionnaire
       (id, customer_id, document_id, template_kind, reporting_year, status, direction, due_date, created_at)
     VALUES (?, ?, NULL, 'cat1_supplier_disclosure', 2026, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    customerId,
    opts.status ?? 'sent',
    opts.direction ?? 'inbound',
    opts.due,
    new Date().toISOString(),
  );
}

function lastNotifiedSetting(db: InstanceType<typeof Database>): string | undefined {
  const row = db
    .prepare(`SELECT value FROM setting WHERE key = 'overdue_notify.last_notified_date'`)
    .get() as { value: string } | undefined;
  return row?.value;
}

beforeEach(() => {
  H.FakeNotification.supported = true;
  H.FakeNotification.instances.length = 0;
  H.state.win = null;
  H.state.created = 0;
});

describe('notifyOverdueDisclosures', () => {
  it('raises one aggregate notification when a sent disclosure is past due', () => {
    const db = setup();
    seedDisclosure(db, { name: '中山钢铁', due: '2026-07-10' });

    const result = notifyOverdueDisclosures(db, TODAY);

    expect(result).toEqual({ notified: true, count: 1 });
    expect(H.FakeNotification.instances.length).toBe(1);
    const n = H.FakeNotification.instances[0];
    expect(n?.didShow).toBe(true);
    expect(n?.opts.title).toBe('供应商披露逾期');
    expect(n?.opts.body).toContain('中山钢铁');
    expect(lastNotifiedSetting(db)).toBe(TODAY);
  });

  it('aggregates: three overdue rows → one notification naming the count', () => {
    const db = setup();
    seedDisclosure(db, { name: '甲供应商', due: '2026-07-01' });
    seedDisclosure(db, { name: '乙供应商', due: '2026-07-05' });
    seedDisclosure(db, { name: '丙供应商', due: '2026-07-08' });

    const result = notifyOverdueDisclosures(db, TODAY);

    expect(result).toEqual({ notified: true, count: 3 });
    expect(H.FakeNotification.instances.length).toBe(1);
    expect(H.FakeNotification.instances[0]?.opts.body).toContain('等 3 份');
  });

  it('ignores future due dates, received/ingested rows, and outbound rows', () => {
    const db = setup();
    seedDisclosure(db, { name: '未到期', due: '2026-12-31' });
    seedDisclosure(db, { name: '已回收', due: '2026-07-01', status: 'received' });
    seedDisclosure(db, { name: '已入库', due: '2026-07-01', status: 'ingested' });
    seedDisclosure(db, { name: '无截止', due: null });
    seedDisclosure(db, {
      name: '外发问卷',
      due: '2026-07-01',
      status: 'sent',
      direction: 'outbound',
    });

    const result = notifyOverdueDisclosures(db, TODAY);

    expect(result).toEqual({ notified: false, count: 0 });
    expect(H.FakeNotification.instances.length).toBe(0);
    expect(lastNotifiedSetting(db)).toBeUndefined();
  });

  it('notifies at most once per local day, and again the next day', () => {
    const db = setup();
    seedDisclosure(db, { name: '中山钢铁', due: '2026-07-10' });

    expect(notifyOverdueDisclosures(db, TODAY).notified).toBe(true);
    expect(notifyOverdueDisclosures(db, TODAY).notified).toBe(false);
    expect(H.FakeNotification.instances.length).toBe(1);

    expect(notifyOverdueDisclosures(db, '2026-07-14').notified).toBe(true);
    expect(H.FakeNotification.instances.length).toBe(2);
    expect(lastNotifiedSetting(db)).toBe('2026-07-14');
  });

  it('no-ops (and records nothing) when Notification is unsupported', () => {
    const db = setup();
    seedDisclosure(db, { name: '中山钢铁', due: '2026-07-10' });
    H.FakeNotification.supported = false;

    const result = notifyOverdueDisclosures(db, TODAY);

    expect(result).toEqual({ notified: false, count: 0 });
    expect(H.FakeNotification.instances.length).toBe(0);
    expect(lastNotifiedSetting(db)).toBeUndefined();
  });

  it('click focuses the live window and deep-links to /supplier-disclosures', () => {
    const db = setup();
    seedDisclosure(db, { name: '中山钢铁', due: '2026-07-10' });
    const win = H.makeWin(false);
    win.minimized = true;
    H.state.win = win;

    notifyOverdueDisclosures(db, TODAY);
    for (const click of H.FakeNotification.instances[0]?.clicks ?? []) click();

    expect(win.restored).toBe(true);
    expect(win.focused).toBeGreaterThan(0);
    expect(win.sent).toEqual([{ channel: 'app:navigate', payload: '/supplier-disclosures' }]);
    expect(H.state.created).toBe(0);
  });

  it('click with no window recreates one and defers the deep link past load', () => {
    vi.useFakeTimers();
    try {
      const db = setup();
      seedDisclosure(db, { name: '中山钢铁', due: '2026-07-10' });
      H.state.win = null;

      notifyOverdueDisclosures(db, TODAY);
      for (const click of H.FakeNotification.instances[0]?.clicks ?? []) click();

      expect(H.state.created).toBe(1);
      const win = H.state.win as unknown as ReturnType<typeof H.makeWin>;
      expect(win.sent).toEqual([]);
      for (const onLoad of win.loadHandlers) onLoad();
      vi.advanceTimersByTime(500);
      expect(win.sent).toEqual([{ channel: 'app:navigate', payload: '/supplier-disclosures' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
