#!/usr/bin/env node
/**
 * Generates the app icon set for electron-builder.
 *
 * Produces three artifacts in `build/`:
 *   - icon.png   1024×1024 PNG, used by Linux and as a generic fallback
 *   - icon.icns  macOS Apple Icon Image container (16/32/64/128/256/512/1024
 *                + their @2x retina variants), packed via `iconutil`
 *   - icon.ico   Windows ICO container with 16/24/32/48/64/128/256 layers,
 *                hand-packed (PNG-in-ICO format; supported by Vista+)
 *
 * The mark itself lives in `icon-designs.mjs` — pick which variant
 * is "active" via the `ICON_DIRECTION=X1|X2|X3` env var, the
 * `--direction=` CLI flag, or by editing the default in the
 * `ACTIVE_DIRECTION` resolution below. Currently shipping: X2 (the
 * stacked-rows "ledger" mark).
 *
 * Preview mode: pass `--preview` to render ALL variants at 1024×1024
 * to `build/preview-X1.png`, `preview-X2.png`, `preview-X3.png`
 * without touching the active `icon.*` set. Useful when iterating.
 *
 * macOS-only step: iconutil is shipped with Xcode Command Line Tools
 * (`xcode-select --install`).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { drawDirectionX1, drawDirectionX2, drawDirectionX3 } from './icon-designs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
mkdirSync(buildDir, { recursive: true });

const directions = {
  X1: drawDirectionX1,
  X2: drawDirectionX2,
  X3: drawDirectionX3,
};

// ───────────────────── CLI ─────────────────────

const previewMode = process.argv.includes('--preview');
const cliDir = process.argv.find((a) => a.startsWith('--direction='))?.split('=')[1];
const ACTIVE_DIRECTION = (cliDir || process.env.ICON_DIRECTION || 'X2').toUpperCase();

if (!directions[ACTIVE_DIRECTION]) {
  console.error(
    `✗ Unknown direction: "${ACTIVE_DIRECTION}". Expected one of: ${Object.keys(directions).join(', ')}.`,
  );
  process.exit(1);
}

// ───────────────── Rasterizer ─────────────────

function render(drawFn, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  return canvas.toBuffer('image/png');
}

// ───────────────── Preview mode ─────────────────

if (previewMode) {
  for (const [name, fn] of Object.entries(directions)) {
    const path = join(buildDir, `preview-${name}.png`);
    writeFileSync(path, render(fn, 1024));
    console.log(`✓ ${path}  (1024×1024 preview, direction ${name})`);
  }
  console.log('\nPreview mode: did NOT touch the active icon.{png,icns,ico} set.');
  process.exit(0);
}

// ───────────────── Production mode ─────────────────

console.log(`Active direction: ${ACTIVE_DIRECTION}`);

const drawFn = directions[ACTIVE_DIRECTION];
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map(sizes.map((sz) => [sz, render(drawFn, sz)]));

// 1. Linux / generic fallback PNG
const pngPath = join(buildDir, 'icon.png');
writeFileSync(pngPath, pngs.get(1024));
console.log(`✓ ${pngPath}  (1024×1024 PNG)`);

// 2. macOS .icns via iconutil
const icnsLayers = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

const iconsetDir = join(buildDir, 'icon.iconset');
rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir);
for (const [sz, name] of icnsLayers) {
  writeFileSync(join(iconsetDir, name), pngs.get(sz));
}

const icnsPath = join(buildDir, 'icon.icns');
try {
  execSync(`iconutil -c icns -o "${icnsPath}" "${iconsetDir}"`, { stdio: 'pipe' });
  console.log(`✓ ${icnsPath}  (10-layer ICNS via iconutil)`);
} catch (err) {
  console.error('✗ iconutil failed — is Xcode Command Line Tools installed?');
  console.error('  Run: xcode-select --install');
  throw err;
} finally {
  rmSync(iconsetDir, { recursive: true, force: true });
}

// 3. Windows .ico (PNG-in-ICO, Vista+)
function packIco(layers) {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  const dirSize = HEADER_SIZE + ENTRY_SIZE * layers.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(layers.length, 4);

  const entries = [];
  let offset = dirSize;
  for (const { size, data } of layers) {
    const entry = Buffer.alloc(ENTRY_SIZE);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...layers.map((l) => l.data)]);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPath = join(buildDir, 'icon.ico');
writeFileSync(icoPath, packIco(icoSizes.map((sz) => ({ size: sz, data: pngs.get(sz) }))));
console.log(`✓ ${icoPath}  (7-layer ICO: ${icoSizes.join('/')})`);

console.log('\nDone.');
