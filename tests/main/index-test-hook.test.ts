import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('main entry — CARBONBOOK_TEST_USER_DATA_DIR hook', () => {
  it('src/main/index.ts honors the test env var before reading userData', () => {
    const src = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8');
    const hookIdx = src.indexOf('CARBONBOOK_TEST_USER_DATA_DIR');
    // Look for the actual usage in the dbPath line, not the comment
    const dbPathIdx = src.indexOf("const dbPath = join(app.getPath('userData')");
    expect(hookIdx, 'hook not found').toBeGreaterThan(-1);
    expect(dbPathIdx, 'userData consumer not found').toBeGreaterThan(-1);
    expect(hookIdx, 'hook must appear before userData consumer').toBeLessThan(dbPathIdx);
  });
});
