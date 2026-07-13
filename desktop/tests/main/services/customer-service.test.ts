import { runMigrations } from '@main/db/migrate';
import { CustomerService } from '@main/services/customer-service';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { db, svc: new CustomerService({ db }) };
}

describe('CustomerService', () => {
  it('createOrGetByName creates a new customer when none exists', () => {
    const { svc } = setup();
    const c = svc.createOrGetByName('Acme Corp');
    expect(c.id).toBeTruthy();
    expect(c.name).toBe('Acme Corp');
    expect(c.notes).toBeNull();
    expect(c.role).toBe('customer');
  });

  it('createOrGetByName returns the same row on subsequent calls with same name', () => {
    const { svc } = setup();
    const c1 = svc.createOrGetByName('Acme Corp');
    const c2 = svc.createOrGetByName('Acme Corp');
    expect(c2.id).toBe(c1.id);
  });

  it('createOrGetByName treats different names as different customers', () => {
    const { svc } = setup();
    const a = svc.createOrGetByName('Acme Corp');
    const b = svc.createOrGetByName('Globex');
    expect(a.id).not.toBe(b.id);
  });

  it('list returns all customers', () => {
    const { svc } = setup();
    svc.createOrGetByName('A');
    svc.createOrGetByName('B');
    const list = svc.list();
    expect(list.length).toBe(2);
  });

  it('list never returns supplier-role rows', () => {
    const { svc } = setup();
    svc.createOrGetByName('A');
    svc.createSupplier({ name: 'Acme Steel' });
    const customers = svc.list();
    expect(customers.length).toBe(1);
    expect(customers[0]?.name).toBe('A');
    expect(customers[0]?.role).toBe('customer');
  });

  it('createOrGetByName does not collide with a supplier of the same name', () => {
    const { svc } = setup();
    const supplier = svc.createSupplier({ name: 'Acme Steel' });
    const customer = svc.createOrGetByName('Acme Steel');
    // Different rows because role-scoped lookup misses the supplier.
    expect(customer.id).not.toBe(supplier.id);
    expect(customer.role).toBe('customer');
    expect(supplier.role).toBe('supplier');
  });

  it('getById returns the customer or null', () => {
    const { svc } = setup();
    const c = svc.createOrGetByName('X');
    expect(svc.getById(c.id)?.name).toBe('X');
    expect(svc.getById('no-such-id')).toBeNull();
  });

  it('getById never returns a supplier row', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel' });
    expect(svc.getById(s.id)).toBeNull();
  });

  it('createSupplier writes a row with role=supplier', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel' });
    expect(s.id).toBeTruthy();
    expect(s.name).toBe('Acme Steel');
    expect(s.notes).toBeNull();
    expect(s.role).toBe('supplier');
  });

  it('createSupplier persists optional notes', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel', notes: 'Tier 1 steel supplier' });
    expect(s.notes).toBe('Tier 1 steel supplier');
  });

  it('createSupplier accepts duplicate names (suppliers are not deduped)', () => {
    const { svc } = setup();
    const a = svc.createSupplier({ name: 'Acme Steel' });
    const b = svc.createSupplier({ name: 'Acme Steel' });
    expect(a.id).not.toBe(b.id);
  });

  it('listSuppliers returns only supplier rows, ordered by name', () => {
    const { svc } = setup();
    svc.createOrGetByName('Customer A');
    svc.createSupplier({ name: 'Zeta Supplies' });
    svc.createSupplier({ name: 'Acme Steel' });
    const suppliers = svc.listSuppliers();
    expect(suppliers.length).toBe(2);
    expect(suppliers[0]?.name).toBe('Acme Steel');
    expect(suppliers[1]?.name).toBe('Zeta Supplies');
    for (const s of suppliers) expect(s.role).toBe('supplier');
  });

  it('listSuppliers returns empty when no suppliers exist', () => {
    const { svc } = setup();
    svc.createOrGetByName('Just A Customer');
    expect(svc.listSuppliers()).toEqual([]);
  });

  it('createSupplier defaults email to null', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel' });
    expect(s.email).toBeNull();
    expect(svc.listSuppliers()[0]?.email).toBeNull();
  });

  it('createSupplier persists optional email (trimmed)', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel', email: '  esg@acme-steel.cn ' });
    expect(s.email).toBe('esg@acme-steel.cn');
    expect(svc.listSuppliers()[0]?.email).toBe('esg@acme-steel.cn');
  });

  it('createSupplier treats a blank email as null', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel', email: '   ' });
    expect(s.email).toBeNull();
  });

  it('setSupplierEmail sets, then clears, the email', () => {
    const { svc } = setup();
    const s = svc.createSupplier({ name: 'Acme Steel' });
    const updated = svc.setSupplierEmail(s.id, 'esg@acme-steel.cn');
    expect(updated?.email).toBe('esg@acme-steel.cn');
    const cleared = svc.setSupplierEmail(s.id, null);
    expect(cleared?.email).toBeNull();
    expect(svc.listSuppliers()[0]?.email).toBeNull();
  });

  it('setSupplierEmail misses customer-role rows and unknown ids', () => {
    const { svc } = setup();
    const c = svc.createOrGetByName('Acme Corp');
    expect(svc.setSupplierEmail(c.id, 'x@y.cn')).toBeNull();
    expect(svc.setSupplierEmail('no-such-id', 'x@y.cn')).toBeNull();
    // The customer row is untouched.
    expect(svc.getById(c.id)?.email).toBeNull();
  });
});
