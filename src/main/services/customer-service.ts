import type { Database } from 'better-sqlite3';
import type { Customer } from '@shared/types';
import { randomUUID } from 'node:crypto';

/**
 * Simple customer registry. Used by the questionnaire pipeline to
 * create-or-get a Customer row by name. No update / delete in v1 —
 * customers are append-only at the v1 horizon.
 */
export class CustomerService {
  constructor(private readonly deps: { db: Database }) {}

  /**
   * Find an existing customer with this exact name OR create a new one.
   * Names are matched case-sensitively; trim whitespace before passing in
   * if you want loose matching.
   */
  createOrGetByName(name: string): Customer {
    const existing = this.deps.db
      .prepare(`SELECT id, name, notes FROM customer WHERE name = ?`)
      .get(name) as Customer | undefined;
    if (existing) return existing;
    const id = randomUUID();
    this.deps.db.prepare(`INSERT INTO customer (id, name, notes) VALUES (?, ?, NULL)`).run(id, name);
    return { id, name, notes: null };
  }

  list(): Customer[] {
    return this.deps.db
      .prepare(`SELECT id, name, notes FROM customer ORDER BY name`)
      .all() as Customer[];
  }

  getById(id: string): Customer | null {
    const row = this.deps.db
      .prepare(`SELECT id, name, notes FROM customer WHERE id = ?`)
      .get(id) as Customer | undefined;
    return row ?? null;
  }
}
