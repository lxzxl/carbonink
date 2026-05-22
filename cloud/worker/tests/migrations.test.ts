import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('D1 migrations', () => {
  it('customer table exists and accepts inserts', async () => {
    await env.DB.exec(
      `INSERT INTO customer (user_id, email, created_at) VALUES ('usr_test', 'test@example.com', 1700000000)`,
    );
    const row = await env.DB.prepare('SELECT * FROM customer WHERE user_id = ?')
      .bind('usr_test')
      .first();
    expect(row).toBeTruthy();
    expect(row?.email).toBe('test@example.com');
  });

  it('license table exists with foreign key to customer', async () => {
    await env.DB.exec(
      `INSERT INTO customer (user_id, email, created_at) VALUES ('usr_fk', 'fk@example.com', 1700000000)`,
    );
    await env.DB.exec(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_test', 'usr_fk', 'cbk-aaaaa-bbbbb-ccccc-ddddd', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1710000000, 1720000000)`,
    );
    const row = await env.DB.prepare('SELECT * FROM license WHERE license_id = ?')
      .bind('lic_test')
      .first();
    expect(row).toBeTruthy();
    expect(row?.plan).toBe('base@2026-q2');
  });

  it('device table has composite primary key', async () => {
    await env.DB.exec(
      `INSERT INTO customer (user_id, email, created_at) VALUES ('usr_dev', 'dev@example.com', 1700000000)`,
    );
    await env.DB.exec(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_dev', 'usr_dev', 'cbk-ddddd-eeeee-fffff-ggggg', 'base@2026-q2', '[]', 1, 1700000000, 1710000000, 1720000000)`,
    );
    await env.DB.exec(
      `INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at) VALUES ('dev_abc', 'lic_dev', 1700000000, 1700000000)`,
    );
    const row = await env.DB.prepare('SELECT * FROM device WHERE device_id = ? AND license_id = ?')
      .bind('dev_abc', 'lic_dev')
      .first();
    expect(row).toBeTruthy();
  });
});
