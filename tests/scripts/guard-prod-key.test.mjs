import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const guardSrc = readFileSync(join(__dirname, '..', '..', 'scripts', 'guard-prod-key.mjs'), 'utf8');

const PLACEHOLDER = '0'.repeat(64);
const DEV_KEY_MATCH = guardSrc.match(/const DEV_KEY = '([0-9a-f]{64})'/);
if (!DEV_KEY_MATCH) throw new Error('guard-prod-key.mjs no longer declares DEV_KEY');
const DEV_KEY = DEV_KEY_MATCH[1];

function detect(content) {
  if (content.includes(PLACEHOLDER)) return 'placeholder';
  if (content.includes(DEV_KEY)) return 'dev-key';
  return 'ok';
}

describe('guard-prod-key detection rules', () => {
  it('flags the all-zero placeholder', () => {
    const content = `const PUBLIC_KEY_HEX = '${PLACEHOLDER}';`;
    expect(detect(content)).toBe('placeholder');
  });

  it('flags the embedded development key', () => {
    const content = `const PUBLIC_KEY_HEX = '${DEV_KEY}';`;
    expect(detect(content)).toBe('dev-key');
  });

  it('passes a clean production-shaped hex (neither placeholder nor dev)', () => {
    const fakeProd = 'a'.repeat(64);
    const content = `const PUBLIC_KEY_HEX = '${fakeProd}';`;
    expect(detect(content)).toBe('ok');
  });
});
