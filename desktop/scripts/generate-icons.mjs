#!/usr/bin/env node
/**
 * Generates the real app icon set for electron-builder.
 *
 * Produces three artifacts in `build/`:
 *   - icon.png   1024×1024 PNG, used by Linux and as a generic fallback
 *   - icon.icns  macOS Apple Icon Image container (16/32/64/128/256/512/1024
 *                + their @2x retina variants), packed via `iconutil`
 *   - icon.ico   Windows ICO container with 16/24/32/48/64/128/256 layers,
 *                hand-packed (PNG-in-ICO format; supported by Vista+)
 *
 * The mark is the `LogoMark.astro` brand glyph (sky-500 rounded square +
 * white droplet arch + horizontal bar + dot) rendered via @napi-rs/canvas.
 * All sizes are rasterised from the same path commands so the icon is
 * pixel-clean at every resolution — no scaling artefacts.
 *
 * macOS-only step: iconutil is shipped with Xcode Command Line Tools.
 * `xcode-select --install` is the prerequisite on a fresh machine. The
 * script bails with a clear message if iconutil is missing rather than
 * silently producing a broken file.
 *
 * Run via `pnpm icons` or directly with `node scripts/generate-icons.mjs`.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
mkdirSync(buildDir, { recursive: true });

// ---------- LogoMark renderer (mirrors cloud/web/src/components/LogoMark.astro) ----------

/**
 * Draw a rounded rectangle path. We don't rely on `ctx.roundRect` because
 * older @napi-rs/canvas releases (we currently resolve 0.1.80 and 0.1.100
 * in the workspace) didn't ship it consistently — the quadratic-curve
 * fallback works on every backend.
 */
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Render the LogoMark at the requested pixel size. The source SVG is in
 * a 28-unit viewBox; we scale linearly so strokes / radii remain visually
 * identical at every size.
 */
function renderLogo(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 28; // viewBox→pixel scale

  // Sky-500 rounded-square background — matches --color-primary in the web
  // pages and the BrowserWindow chrome's accent.
  roundedRectPath(ctx, 0, 0, size, size, 5 * s);
  ctx.fillStyle = '#0ea5e9';
  ctx.fill();

  // Droplet arch: bezier from (8,20) → (14,7) → (20,20)
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(8 * s, 20 * s);
  ctx.bezierCurveTo(8 * s, 14 * s, 12 * s, 8 * s, 14 * s, 7 * s);
  ctx.bezierCurveTo(16 * s, 8 * s, 20 * s, 14 * s, 20 * s, 20 * s);
  ctx.stroke();

  // Crossbar — the "ink line" inside the droplet
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(11 * s, 17 * s);
  ctx.lineTo(17 * s, 17 * s);
  ctx.stroke();

  // Apex dot
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(14 * s, 7 * s, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toBuffer('image/png');
}

// ---------- Render every size we'll need across all three formats ----------

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map(sizes.map((sz) => [sz, renderLogo(sz)]));

// ---------- 1. Linux / generic fallback PNG ----------

const pngPath = join(buildDir, 'icon.png');
writeFileSync(pngPath, pngs.get(1024));
console.log(`✓ ${pngPath}  (1024×1024 PNG)`);

// ---------- 2. macOS .icns via iconutil ----------

/**
 * Apple's iconset naming convention. Each base size also wants an @2x
 * retina variant at double resolution. iconutil packs the folder into
 * a proper .icns with all layers indexed.
 */
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

// ---------- 3. Windows .ico (PNG-in-ICO, Vista+) ----------

/**
 * The ICO format is a tiny directory header + one entry per image + the
 * concatenated image data. Vista (and every Windows version since) accepts
 * PNG bytes inside the entries — there's no need to expand to BMP.
 *
 * All fields are little-endian. Width/height fields are 1 byte each and
 * encode 256 as `0` (since the byte can only hold 0–255).
 */
function packIco(layers) {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  const dirSize = HEADER_SIZE + ENTRY_SIZE * layers.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (ICO)
  header.writeUInt16LE(layers.length, 4);

  const entries = [];
  let offset = dirSize;
  for (const { size, data } of layers) {
    const entry = Buffer.alloc(ENTRY_SIZE);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count (0 = no palette)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...layers.map((l) => l.data)]);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPath = join(buildDir, 'icon.ico');
writeFileSync(icoPath, packIco(icoSizes.map((sz) => ({ size: sz, data: pngs.get(sz) }))));
console.log(`✓ ${icoPath}  (7-layer ICO: ${icoSizes.join('/')})`);

console.log('\nDone. Icons regenerated from LogoMark source.');
