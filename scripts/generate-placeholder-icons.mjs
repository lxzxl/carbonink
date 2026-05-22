#!/usr/bin/env node
/**
 * Generates placeholder app icons under `build/` so electron-builder's
 * path-existence check passes during config validation.
 *
 * These icons are NOT production assets — they are 1024×1024 solid-blue
 * tiles with a single white "C" glyph. The production launch checklist
 * must replace them with real branded icons before shipping signed
 * artifacts. See `build/README.md`.
 *
 * Implementation note: real `.icns` (Apple Icon Image) and `.ico`
 * (Windows Icon) formats use container layouts that PNG can't represent.
 * We deliberately ship raw PNG bytes inside those filenames as
 * placeholders — electron-builder will produce a broken or fallback
 * icon at build time, which is fine for the Phase 5 config-only commit
 * (we don't run `dist:*` here). The real files must be supplied by
 * design before launch.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
mkdirSync(buildDir, { recursive: true });

const canvas = createCanvas(1024, 1024);
const ctx = canvas.getContext('2d');

// Brand blue background.
ctx.fillStyle = '#0ea5e9';
ctx.fillRect(0, 0, 1024, 1024);

// White "C" glyph centered.
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 640px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('C', 512, 540);

const png = canvas.toBuffer('image/png');

writeFileSync(join(buildDir, 'icon.png'), png);
// `.icns` / `.ico` are placeholders only — see the file header comment.
writeFileSync(join(buildDir, 'icon.icns'), png);
writeFileSync(join(buildDir, 'icon.ico'), png);

process.stdout.write(`✓ wrote placeholder icons to ${buildDir}\n`);
