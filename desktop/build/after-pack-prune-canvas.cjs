// electron-builder afterPack hook — prune foreign @napi-rs/canvas prebuilds.
//
// Background: the mac CI runner builds BOTH arm64 and x64 dmgs from a single
// install. pnpm installs every platform prebuild (root
// `pnpm.supportedArchitectures`), but electron-builder's dep collector only
// stages the HOST arch's optional dep into each target — so the Intel dmg
// missed its .node and PDF→image rendering was broken on every Intel Mac
// (v1.0.0–v1.1.0). canvas-darwin-x64 is a DIRECT dependency so it is always
// staged; this hook deletes every prebuild except the current target's from
// the staged app, once per arch.
//
// Why a hook and not `files`: in electron-builder v26 a platform-level
// `files` block REPLACES the top-level `files` list instead of merging with
// it, which reverts the main matcher to include-all `**/*` (observed
// 2026-10-08: scripts/, tests/, src/ shipped in app.asar). There is no
// `${arch}`-complement in minimatch, so per-arch pruning lives here.
//
// The .node binaries land in app.asar.unpacked (electron-builder auto-unpacks
// native modules); the hook removes the foreign arch's directory there. It
// throws when the KEEP binary is missing so a broken dmg fails the pack
// loudly instead of failing at PDF-upload time on user machines.
const { existsSync, readdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const OS_PART = { darwin: 'darwin', win32: 'win32', linux: 'linux' };
// electron-builder passes Arch as a NUMBER (ia32: 0, x64: 1, armv7l: 2,
// arm64: 3); be liberal and accept the string form too.
const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };

exports.default = async function pruneForeignCanvasPrebuilds(context) {
  const osPart = OS_PART[context.electronPlatformName];
  if (!osPart) return;
  const arch = typeof context.arch === 'number' ? ARCH_NAME[context.arch] : context.arch;
  if (!arch) return;
  // Prefix match: platform packages carry toolchain suffixes
  // (canvas-win32-x64-msvc, canvas-linux-x64-gnu, …).
  const keepPrefix = `canvas-${osPart}-${arch}`;

  // Locate every Resources dir for this target (mac .app bundle vs win).
  const resourcesDirs = [path.join(context.appOutDir, 'resources')];
  if (existsSync(context.appOutDir)) {
    for (const entry of readdirSync(context.appOutDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        resourcesDirs.push(path.join(context.appOutDir, entry.name, 'Contents', 'Resources'));
      }
    }
  }

  let keepFound = false;
  for (const resourcesDir of resourcesDirs) {
    const napiDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@napi-rs');
    if (!existsSync(napiDir)) continue;
    for (const entry of readdirSync(napiDir)) {
      // The arch-independent loader package (`canvas` itself) always stays.
      if (!entry.startsWith('canvas-')) continue;
      const full = path.join(napiDir, entry);
      if (entry.startsWith(keepPrefix)) {
        keepFound = true;
        continue;
      }
      rmSync(full, { recursive: true, force: true });
      process.stderr.write(
        `[prune-canvas] Removed foreign prebuild ${entry} (keeping ${keepPrefix}*).\n`,
      );
    }
  }

  if (!keepFound) {
    throw new Error(
      `[prune-canvas] Missing expected prebuild ${keepPrefix}* in ${context.appOutDir} — ` +
        'the packed app would fail PDF-to-image rendering. Check pnpm.supportedArchitectures.',
    );
  }
};
