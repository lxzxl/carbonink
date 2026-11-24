# CarbonInk · 碳墨

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue.svg)](https://github.com/lxzxl/carbonink/releases/latest)
[![Download](https://img.shields.io/badge/download-latest%20release-brightgreen.svg)](https://github.com/lxzxl/carbonink/releases/latest)

**Free, open-source, local-first GHG accounting for the desktop.** Import your bills, let AI extract the activity data, and produce an ISO 14064-1 or TCFD inventory report — entirely on your own machine. No account, no cloud, no subscription.

> Licensed under the [MIT License](LICENSE). Runs fully offline; your data never leaves your device.

![CarbonInk — ISO 14064-1 GHG inventory dashboard, running locally](cloud/web/public/screenshots/en/dashboard.png)

## Download

Grab the latest macOS / Windows build from the [releases page](https://github.com/lxzxl/carbonink/releases/latest) — or visit [carbonink.xyz](https://carbonink.xyz). No activation key required.

## What it does

- **Inventory** — emission sources, activity data, and pinned emission factors with audit-grade calculation snapshots (Scope 1 / 2 / 3).
- **AI extraction** — pull activity data from utility bills, fuel receipts, freight, travel, and purchase documents (bring your own LLM API key).
- **Questionnaires** — fill customer/rating-agency disclosure forms from your inventory (outbound), and collect supplier Scope 3 Cat 1 data (inbound).
- **Reports** — one-click ISO 14064-1 & TCFD inventory reports (PDF) with readiness checks.
- **MCP** — exposes your inventory to Claude / Cursor / Pi via a built-in MCP server.

## Build from source

```bash
# CarbonInk 2.0 (NSGo native desktop app, app/)
pnpm app:dev                     # hot-reloading native window
pnpm app:test                    # headless UI tests (go tool nsgo test)
pnpm app:build                   # macOS arm64 build

# CarbonInk 1.x (Electron desktop app, desktop/)
pnpm install
pnpm --filter carbonink dev      # run the Electron app
pnpm --filter carbonink test     # vitest
pnpm --filter carbonink build    # production build (electron-builder)
```

See [`AGENTS.md`](AGENTS.md) for repo conventions and [`docs/`](docs/) for conventions and local design docs.

## Repo layout

| Path | What |
|---|---|
| `app/` | NSGo native desktop app (CarbonInk 2.0, Go) |
| `desktop/` | Electron desktop app (`carbonink` 1.x) |
| `cloud/web/` | Astro static marketing site ([carbonink.xyz](https://carbonink.xyz)) |
| `docs/` | Tracked conventions (`docs/conventions/`) and local-only design trail |
