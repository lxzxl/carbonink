import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    LICENSE_ACTIVE: KVNamespace;
    REVOCATION_SET: KVNamespace;
    HUMANIZED_KEYS: KVNamespace;
    RATE_LIMIT: KVNamespace;
    RELEASES: R2Bucket;
    TEST_MIGRATIONS: D1Migration[];
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
