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
pnpm app:check                   # regenerate locales, vet, and check targets
pnpm app:test                    # Go + headless UI tests (go test && go tool nsgo test)
pnpm app:build                   # macOS arm64 build
```

See [`AGENTS.md`](AGENTS.md) for repo conventions, [`app/README.md`](app/README.md) for desktop app details, and [`docs/`](docs/) for conventions and local design docs.

## Repo layout

| Path | What |
|---|---|
| `app/` | CarbonInk 2.0 native desktop app (NSGo, Go) |
| `cloud/web/` | Astro static marketing site ([carbonink.xyz](https://carbonink.xyz)) |
| `docs/` | Tracked conventions (`docs/conventions/`) and local-only design trail |

> Note: CarbonInk 1.x (Electron) is archived at branch `archive/v1-electron` and tag `v1.2.0`.
