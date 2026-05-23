import { runMigrations } from '@main/db/migrate';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { OrganizationService } from '@main/services/organization-service';
import type { Organization, Site } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXED_NOW = '2026-05-11T00:00:00.000Z';

let db: Database.Database;
let svc: EmissionSourceService;
let orgSvc: OrganizationService;
let org: Organization;
let site1: Site;
let site2: Site;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };
  orgSvc = new OrganizationService(ctx);
  svc = new EmissionSourceService(ctx);
  org = orgSvc.createOrganization({
    name_en: 'Acme Co',
    country_code: 'CN',
    boundary_kind: 'operational_control',
  });
  site1 = orgSvc.createSite({
    organization_id: org.id,
    name_en: 'Site One',
    country_code: 'CN',
  });
  site2 = orgSvc.createSite({
    organization_id: org.id,
    name_en: 'Site Two',
    country_code: 'CN',
  });
});

afterEach(() => db.close());

describe('EmissionSourceService.create', () => {
  it('persists and returns a row with generated ULID + is_active=true', () => {
    const es = svc.create({
      site_id: site1.id,
      name: 'Boiler #1',
      scope: 1,
      category: 'stationary_combustion',
    });
    expect(es.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(es.site_id).toBe(site1.id);
    expect(es.name).toBe('Boiler #1');
    expect(es.scope).toBe(1);
    expect(es.category).toBe('stationary_combustion');
    expect(es.is_active).toBe(true);
    // Optional fields default to null
    expect(es.ghg_protocol_path).toBeNull();
    expect(es.default_ef_query).toBeNull();
    expect(es.template_origin).toBeNull();
  });

  it('propagates FK error when site_id does not exist', () => {
    expect(() =>
      svc.create({
        site_id: 'site_does_not_exist',
        name: 'Orphan source',
        scope: 2,
      }),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('EmissionSourceService.getById', () => {
  it('returns the row for an existing id', () => {
    const created = svc.create({ site_id: site1.id, name: 'Grid meter', scope: 2 });
    const fetched = svc.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe('Grid meter');
    expect(fetched?.is_active).toBe(true);
  });

  it('returns null for a missing id', () => {
    expect(svc.getById('does_not_exist')).toBeNull();
  });
});

describe('EmissionSourceService.listBySite', () => {
  it('returns all sources for the given site, sorted by scope/name', () => {
    svc.create({ site_id: site1.id, name: 'Z-Boiler', scope: 1 });
    svc.create({ site_id: site1.id, name: 'A-Grid', scope: 2 });
    svc.create({ site_id: site1.id, name: 'B-Boiler', scope: 1 });
    // Source on a different site — must NOT appear in site1 listing.
    svc.create({ site_id: site2.id, name: 'Other-site source', scope: 1 });

    const rows = svc.listBySite(site1.id);
    expect(rows).toHaveLength(3);
    // scope 1 first (B-Boiler, Z-Boiler by name), then scope 2 (A-Grid).
    expect(rows.map((r) => r.name)).toEqual(['B-Boiler', 'Z-Boiler', 'A-Grid']);
    for (const r of rows) {
      expect(r.site_id).toBe(site1.id);
    }
  });
});

describe('EmissionSourceService.listByOrganization', () => {
  it('returns sources across multiple sites in the same organization', () => {
    svc.create({ site_id: site1.id, name: 'S1-Boiler', scope: 1 });
    svc.create({ site_id: site2.id, name: 'S2-Grid', scope: 2 });

    const rows = svc.listByOrganization(org.id);
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['S1-Boiler', 'S2-Grid']);
  });

  it('returns empty array for an organization with no sources', () => {
    // Create a second org with its own site; the original `org` has 2 sites
    // but zero sources.
    expect(svc.listByOrganization(org.id)).toEqual([]);
  });
});

describe('EmissionSourceService.update', () => {
  it('patches only provided fields and leaves the rest alone', () => {
    const created = svc.create({
      site_id: site1.id,
      name: 'Original',
      scope: 1,
      category: 'cat_A',
      ghg_protocol_path: 'scope1.stationary',
    });
    const updated = svc.update({ id: created.id, name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    // unchanged
    expect(updated.scope).toBe(1);
    expect(updated.category).toBe('cat_A');
    expect(updated.ghg_protocol_path).toBe('scope1.stationary');
    expect(updated.is_active).toBe(true);
  });

  it('converts is_active boolean → integer for storage and back to boolean on read', () => {
    const created = svc.create({ site_id: site1.id, name: 'Toggleable', scope: 1 });
    const off = svc.update({ id: created.id, is_active: false });
    expect(off.is_active).toBe(false);
    const back = svc.update({ id: created.id, is_active: true });
    expect(back.is_active).toBe(true);
  });

  it('throws when the id does not exist', () => {
    expect(() => svc.update({ id: 'does_not_exist', name: 'X' })).toThrow(
      /emission_source not found/,
    );
  });
});

describe('EmissionSourceService.delete', () => {
  it('soft-deletes by setting is_active=0; getById still returns row but with is_active=false', () => {
    const created = svc.create({ site_id: site1.id, name: 'To delete', scope: 1 });
    expect(created.is_active).toBe(true);

    svc.delete(created.id);

    const after = svc.getById(created.id);
    expect(after).not.toBeNull();
    expect(after?.is_active).toBe(false);
    expect(after?.name).toBe('To delete'); // row still readable
  });

  it('throws when the id does not exist', () => {
    expect(() => svc.delete('does_not_exist')).toThrow(/emission_source not found/);
  });
});

describe('EmissionSourceService.createBatch', () => {
  it('inserts all rows in one transaction and returns them in input order', () => {
    const inputs = [
      { site_id: site1.id, name: 'A', scope: 1 as const, category: 'cat_A' },
      { site_id: site1.id, name: 'B', scope: 2 as const, category: 'cat_B' },
      { site_id: site1.id, name: 'C', scope: 3 as const, category: 'cat_C' },
    ];
    const rows = svc.createBatch(inputs);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(rows.map((r) => r.scope)).toEqual([1, 2, 3]);
    for (const r of rows) {
      expect(r.is_active).toBe(true);
      expect(r.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
    // Persisted — listBySite picks them up.
    expect(svc.listBySite(site1.id)).toHaveLength(3);
  });

  it('rolls back the entire batch when one input fails FK validation', () => {
    // First two are valid, third points at a non-existent site → FK fires.
    // The transaction wrapper must unwind the first two inserts too.
    const inputs = [
      { site_id: site1.id, name: 'Good 1', scope: 1 as const },
      { site_id: site1.id, name: 'Good 2', scope: 2 as const },
      { site_id: 'site_does_not_exist', name: 'Bad', scope: 1 as const },
    ];
    expect(() => svc.createBatch(inputs)).toThrow(/FOREIGN KEY/i);
    // Nothing committed — table is empty.
    expect(svc.listBySite(site1.id)).toEqual([]);
  });

  it('returns [] for empty input without touching the database', () => {
    expect(svc.createBatch([])).toEqual([]);
    expect(svc.listBySite(site1.id)).toEqual([]);
  });
});
