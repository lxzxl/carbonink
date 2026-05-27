import { randomUUID } from 'node:crypto';
import type { Customer, Supplier } from '@shared/types';
import type { Database } from 'better-sqlite3';

/**
 * Simple counterparty registry. Backs both the outbound flow (customers)
 * and the inbound flow (suppliers): same physical `customer` table,
 * differentiated by the `role` column added in migration 017.
 *
 * Convention: every method on this service is role-scoped. The original
 * customer-facing methods (`createOrGetByName`, `list`, `getById`) only
 * see role='customer' rows. Supplier methods (`listSuppliers`,
 * `createSupplier`) only see role='supplier' rows. Callers never have to
 * filter manually.
 */
export class CustomerService {
  constructor(private readonly deps: { db: Database }) {}

  /**
   * Find an existing customer with this exact name OR create a new one.
   * Names are matched case-sensitively; trim whitespace before passing in
   * if you want loose matching. Customer-scoped: never returns or touches
   * a supplier row.
   */
  createOrGetByName(name: string): Customer {
    const existing = this.deps.db
      .prepare(`SELECT id, name, notes, role FROM customer WHERE name = ? AND role = 'customer'`)
      .get(name) as Customer | undefined;
    if (existing) return existing;
    const id = randomUUID();
    this.deps.db
      .prepare(`INSERT INTO customer (id, name, notes, role) VALUES (?, ?, NULL, 'customer')`)
      .run(id, name);
    return { id, name, notes: null, role: 'customer' };
  }

  list(): Customer[] {
    return this.deps.db
      .prepare(`SELECT id, name, notes, role FROM customer WHERE role = 'customer' ORDER BY name`)
      .all() as Customer[];
  }

  getById(id: string): Customer | null {
    const row = this.deps.db
      .prepare(`SELECT id, name, notes, role FROM customer WHERE id = ? AND role = 'customer'`)
      .get(id) as Customer | undefined;
    return row ?? null;
  }

  /**
   * List all supplier-role rows, ordered by name. Used by the inbound-draft
   * wizard's SupplierPicker. Never returns customer rows.
   */
  listSuppliers(): Supplier[] {
    return this.deps.db
      .prepare(`SELECT id, name, notes, role FROM customer WHERE role = 'supplier' ORDER BY name`)
      .all() as Supplier[];
  }

  /**
   * Create a new supplier row. We deliberately do NOT do a get-or-create on
   * suppliers — duplicate names are allowed since two distinct legal
   * entities may share a colloquial name and the user knows which is which.
   * If you want create-or-get behavior, the caller can `listSuppliers()`
   * first and filter.
   */
  createSupplier(input: { name: string; notes?: string }): Supplier {
    const id = randomUUID();
    const notes = input.notes ?? null;
    this.deps.db
      .prepare(`INSERT INTO customer (id, name, notes, role) VALUES (?, ?, ?, 'supplier')`)
      .run(id, input.name, notes);
    return { id, name: input.name, notes, role: 'supplier' };
  }
}
