# CarbonInk desktop — NSGo

CarbonInk 2.0's desktop app. Phase 1 opens the active workspace from the
Electron-era registry and renders its activity ledger from the real SQLite
database. The remaining feature screens arrive in Phase 2 and later; the
plan is [`docs/plans/2026-11-19-nsgo-migration.md`](../docs/plans/2026-11-19-nsgo-migration.md).

## Prerequisites

- Go 1.27.4 (`go.mod` pins the toolchain)
- Xcode command-line tools for the macOS backend
- `scripts/fetch-fonts.sh` only for the Phase 0 report experiment

## Run and test

```bash
cd app
go tool nsgo dev .                 # hot-reloading native window
go tool nsgo test .                # headless UI tests (nsgotest)
go test ./...                      # pure Go + headless UI packages
go tool nsgo build -target macos_arm64
go tool nsgo build -target windows_x64
```

Root shortcuts: `pnpm app:dev`, `pnpm app:test`, `pnpm app:build`.

## Layout

| Path | What |
| --- | --- |
| `main.go` | `nsgo.Run` entry point |
| `internal/app` | Shell, navigation, activity table |
| `internal/workspace` | `workspaces.json`, active workspace, legacy import |
| `internal/store` | SQLite open, migrations, activity queries |
| `internal/backup` | Daily `VACUUM INTO` snapshots, 7 per workspace |
| `internal/prefs` | Theme, language, window frame (`settings.json`) |
| `internal/platform` | Legacy Electron path discovery |
| `locales/` | NSGo ICU catalogs (`en`, `zh-CN`) + generated Go |
| `internal/spike` | Phase 0 harness, kept as reference; not wired into the app |

## Workspace data

The app id is `app.carbonink.desktop.beta`, so 1.x and 2.0 can coexist. On the
first launch, if the NSGo data directory has no `workspaces.json`, the app
imports the Electron directory:

- `workspaces.json`
- every `*.sqlite` with its `-wal` / `-shm` siblings
- `auto-backups/`
- `uploads/`

The import copies; it never moves or edits the legacy directory. Close
CarbonInk 1.x before the first 2.0 launch so the copied database is consistent.
`CARBONINK_LEGACY_DIR` overrides the source, and
`CARBONINK_NO_LEGACY_IMPORT=1` disables it (tests).

`CARBONINK_TEST_DB` opens one database directly and skips the registry; the
headless UI test uses it for a fixture workspace.

Logs are JSON lines in `cx.LogsDir()` (`~/Library/Logs/app.carbonink.desktop.beta`
on macOS), rotated at 5 MB. On startup the app keeps at most seven daily
snapshots under `<data>/auto-backups/<workspace_id>/`, using the 1.x file name.

The NSGo update public key is in `nsgo.yaml`; its secret is in
`.nsgo/updates-key.txt` (gitignored). Move that secret to a password manager and
to the release environment as `NSGO_UPDATES_KEY`. The channel stays `none`
until the 2.0 appcast is hosted.

## Phase 1 status

- Workspace registry, active workspace, one-time legacy import: done
- SQLite (cgo-free, FTS5, JSON1, WAL) and the 22 Electron migrations: done
- Real activity ledger (5,000 rows) with sort/resize/scroll: done
- NSGo catalogs with en + zh-CN, including all 1,206 Electron keys
  (`go run ./cmd/genlocales`): done
- Theme switch, locale switch, window-frame restore: done
- Command palette (`mod+k`) with screen and file commands: done
- JSON logging and daily auto-backup: done
- Signing/notarization and the update appcast: pending

## Phase 0 results (2026-11-19, macOS 15.8.3 arm64)

| Gate | Target | Measured |
| --- | --- | --- |
| Chinese text extraction | ≥ 95% accuracy | PDFium-WASM: correct CJK on all fixtures, 12–15 ms/page |
| PDF raster (200 DPI) | vision-model input | 1656×2342 PNG, 226 KB, ~76 ms |
| Report PDF | CJK, tables, page breaks | 3-page A4, 46 KB, 16–22 ms |
| Cold start | ≤ 500 ms | 642 ms first run, 331–350 ms warm |
| Installer | ≤ 25 MB | 4.6 MB DMG (16 MB `.app`) |
| Idle RAM | ≤ 200 MB | 133–136 MB |
| Windows build | runs three flows | cross-build OK (16.8 MB); runtime pending |
| SQLite | FTS5 + JSON1 + WAL | all pass against a real workspace DB |

PDFium runs through wazero: no cgo, no Chromium, no Node.
