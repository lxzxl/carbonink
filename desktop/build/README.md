# `build/` — electron-builder resources

This directory holds the resources electron-builder consumes when
producing distributable installers (`.dmg`, `.exe`).

## Contents

| File                     | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `icon.png`               | 1024×1024 PNG (Linux + dev-mode fallback)                  |
| `icon.icns`              | macOS app icon — 10-layer Apple Icon Image container       |
| `icon.ico`               | Windows app icon — 7-layer ICO (16/24/32/48/64/128/256)    |
| `entitlements.mac.plist` | macOS Hardened Runtime entitlements (required to notarize) |
| `sign-windows.js`        | electron-builder hook → Azure Trusted Signing via signtool |

## Regenerating the icons

All three icon containers are derived from `LogoMark.astro` (the brand
glyph used on the marketing site). Re-run after any logo design change:

```bash
node scripts/generate-icons.mjs
```

The script:

1. Renders the LogoMark via `@napi-rs/canvas` at every size needed
   across the three formats (16 / 24 / 32 / 48 / 64 / 128 / 256 / 512 / 1024).
2. Packs the macOS `.icns` via `iconutil` — requires Xcode Command Line
   Tools (`xcode-select --install`).
3. Hand-packs the Windows `.ico` as PNG-in-ICO (Vista+ format).
4. Writes the 1024 PNG verbatim for Linux.

## Dev-mode icon

The compiled icons are baked into the installer artifacts, but during
`pnpm dev` there's no bundle for the OS to read from. `main/index.ts`
calls `app.dock.setIcon` (macOS) and `BrowserWindow.icon` (Win/Linux)
with the PNG from this directory so the Dock / taskbar match production.
See `devIconPath()` in `src/main/window.ts`.

## Why icons are committed (not generated in CI)

CI builds the installers fresh on each release; we deliberately do NOT
re-run the icon script in CI because it requires `iconutil` (macOS-only)
and we want Windows / Linux runners to be able to build the macOS DMG
from pre-generated assets if needed. Treating the icons as source assets
keeps the build pipeline platform-agnostic.

If you change the icon design, re-run the generator and commit the
updated `.icns` / `.ico` / `.png` together.
