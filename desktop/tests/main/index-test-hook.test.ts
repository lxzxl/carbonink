import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('main entry — CARBONINK_TEST_USER_DATA_DIR hook', () => {
  it('src/main/index.ts honors the test env var before reading userData', () => {
    const src = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8');
    const hookIdx = src.indexOf('CARBONINK_TEST_USER_DATA_DIR');
    // The first real userData consumer is the workspace registry (which
    // resolves the active DB path) — spec 2026-07-22-client-workspaces.
    const consumerIdx = src.indexOf("new WorkspaceService(app.getPath('userData'))");
    expect(hookIdx, 'hook not found').toBeGreaterThan(-1);
    expect(consumerIdx, 'userData consumer not found').toBeGreaterThan(-1);
    expect(hookIdx, 'hook must appear before userData consumer').toBeLessThan(consumerIdx);
  });
});
