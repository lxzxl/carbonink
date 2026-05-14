#!/usr/bin/env node
/**
 * E2E pre-flight guard.
 *
 * `pnpm test:e2e` invokes `pnpm build`, which runs `electron-rebuild` to
 * flip the better-sqlite3 native binary to Electron's Node ABI. If a
 * `pnpm dev` session is running concurrently, electron-vite's watcher
 * sees the binary change and triggers a destabilizing reload cycle in
 * the user's interactive Electron window (looks like rapid flicker).
 *
 * This guard refuses to proceed if it detects `electron-vite dev` in
 * the process list. Stop `pnpm dev` first, then re-run.
 *
 * Detection: `pgrep -fl "electron-vite dev"`. The `-f` flag matches
 * against the full command line; `-l` prints matching lines so the
 * error message can show what's running.
 *
 * Platform: macOS + Linux. Windows is out of scope for v1.
 */
import { execFileSync } from 'node:child_process';

const PATTERN = 'electron-vite dev';

let matches = '';
try {
  matches = execFileSync('pgrep', ['-fl', PATTERN], { encoding: 'utf-8' }).trim();
} catch (err) {
  // pgrep exits 1 when no match found — that's the happy path.
  if (err.status === 1) {
    process.exit(0);
  }
  // Any other failure: warn but don't block (we'd rather a false negative
  // than break the test pipeline when pgrep itself misbehaves).
  console.warn(`[guard-no-dev] pgrep check failed (${err.message}); proceeding anyway.`);
  process.exit(0);
}

if (matches) {
  console.error('');
  console.error('  ❌  `pnpm dev` is running — `pnpm test:e2e` cannot proceed safely.');
  console.error('');
  console.error('      The E2E suite invokes `electron-rebuild`, which rewrites the same');
  console.error('      better-sqlite3 binary your dev Electron has loaded. The rewrite');
  console.error('      triggers a HMR cascade that destabilizes your dev window.');
  console.error('');
  console.error('      Stop `pnpm dev` (Ctrl-C in that terminal), then re-run.');
  console.error('');
  console.error('      Detected process(es):');
  for (const line of matches.split('\n')) {
    console.error(`        ${line}`);
  }
  console.error('');
  process.exit(1);
}

// pgrep returned 0 with no output (shouldn't happen, but be permissive).
process.exit(0);
