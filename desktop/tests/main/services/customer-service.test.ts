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

  it('getById returns the customer or null', () => {
    const { svc } = setup();
    const c = svc.createOrGetByName('X');
    expect(svc.getById(c.id)?.name).toBe('X');
    expect(svc.getById('no-such-id')).toBeNull();
  });
});
