# CarbonInk desktop — NSGo

CarbonInk 2.0's native desktop app (`app.carbonink.desktop`), built with [NSGo](https://github.com/nsgo-dev/nsgo). Runs the full CarbonInk inventory, AI extraction, disclosure, reporting, readiness, and MCP stack against the same SQLite workspace format as CarbonInk 1.x.

## Prerequisites

- Go 1.27.4 (`go.mod` pins the toolchain)
- Xcode command-line tools for macOS builds

## Run, check, and test

```bash
cd app
go tool nsgo check                 # regenerate locales, vet, and check targets
go tool nsgo dev .                 # hot-reloading native window
go test ./...                      # pure Go + headless UI packages
go tool nsgo test ./...            # full NSGo headless UI suite (nsgotest)
go tool nsgo build -target macos_arm64
go tool nsgo build -target windows_x64
```

Root shortcuts: `pnpm app:dev`, `pnpm app:test`, `pnpm app:build`.

## Layout

| Path | What |
| --- | --- |
| `main.go` | `nsgo.Run` entry point |
| `internal/app` | Shell, navigation, screens, dialogs/drawers, command palette |
| `internal/store` | SQLite open, 26 migrations, ledger, audit, and disclosure queries |
| `internal/workspace` | `workspaces.json`, active workspace, one-time 1.x import |
| `internal/extraction` | Document intake, AI extraction stages, vision fallback |
| `internal/efmatch` | Emission factor search, ranking, and unit conversion |
| `internal/questionnaire` / `internal/inbound` / `internal/answer` | Outbound & inbound Scope 3 Cat 1 disclosure workflows |
| `internal/report` / `internal/pdfgen` / `internal/deliverable` | ISO 14064-1 & TCFD reports, PDF/XLSX export, deliverable bundles |
| `internal/readiness` / `internal/lineage` | Pre-export readiness checks and provenance graph |
| `internal/mcp` / `internal/agentbridge` / `internal/agentskill` | Built-in MCP server, agent bridge, skill installer |
| `internal/backup` / `internal/prefs` / `internal/undo` | Daily `VACUUM INTO` snapshots, settings, undo/redo |
| `locales/` | ICU YAML catalogs (`en.yaml`, `zh-CN.yaml`) + generated `catalog_gen.go` |
| `internal/spike` | Phase 0 feasibility harness (kept as reference; not wired into the app) |

## Workspace data & environment

- **App ID:** `app.carbonink.desktop`. On first launch with no `workspaces.json`, copies an existing 2.0-beta (`app.carbonink.desktop.beta`) or 1.x (`carbonink` / `CarbonInk`) directory (`workspaces.json`, `*.sqlite*`, `auto-backups/`, `uploads/`) without modifying the source.
- **Env vars:** `CARBONINK_LEGACY_DIR` overrides the migration import source; `CARBONINK_NO_LEGACY_IMPORT=1` disables legacy import (tests); `CARBONINK_TEST_DB` opens a single SQLite file directly.
- **Logs & backups:** JSON logs in `cx.LogsDir()` (`~/Library/Logs/app.carbonink.desktop` on macOS, rotated at 5 MB); up to 7 daily backups per workspace under `<data>/auto-backups/<workspace_id>/`.
- **Updates:** Public key is in `nsgo.yaml`; secret lives in `.nsgo/updates-key.txt` (gitignored, move to `NSGO_UPDATES_KEY` for releases).
- **PDFium:** Runs via `wazero` (WASM) — no cgo, no Chromium, no Node.
