# CarbonInk desktop — NSGo feasibility spike

Throwaway harness for Phase 0 of
[`docs/plans/2026-11-19-nsgo-migration.md`](../docs/plans/2026-11-19-nsgo-migration.md).
It is not the product: each screen answers one go/no-go question. Delete this
module once the decision is recorded.

## Prerequisites

- Go 1.27.4 (`go.mod` pins the toolchain)
- Xcode command-line tools for the macOS backend
- `scripts/fetch-fonts.sh` for the 17 MB CJK font (report experiment only)

```bash
cd app
./scripts/fetch-fonts.sh
```

## Run and test

```bash
go tool nsgo dev .                 # hot-reloading native window
go tool nsgo test .                # headless UI tests (nsgotest)
go test ./internal/...             # pure-Go tests: PDF, SQLite, LLM adapter
go tool nsgo build -target macos_arm64
go tool nsgo build -target windows_x64
```

Root shortcuts: `pnpm spike:dev`, `pnpm spike:test`, `pnpm spike:build`.

Point the SQLite check at a real workspace database:

```bash
CARBONINK_SPIKE_DB="$HOME/Library/Application Support/carbonink/workspace-<id>.sqlite" \
  go test ./internal/spike -run TestRealWorkspaceDB -v
```

## Screens

| Screen | Question |
| --- | --- |
| Activities | `base/datatable` over 10,000 CJK rows: sort, resize, scroll |
| PDF preview | `core.WebView` over a loopback server, platform PDF viewer |
| PDF text | PDFium-WASM extraction with per-file timing |
| Report PDF | CJK A4 layout with `go-pdf/fpdf`, opened in the system viewer |
| LLM adapter | OpenAI-compatible streaming, tool calls, JSON Schema validation |

## Phase 0 results (2026-11-19, macOS 15.8.3 arm64)

| Gate | Target | Measured |
| --- | --- | --- |
| Chinese text extraction | ≥ 95% accuracy | PDFium-WASM: correct CJK on all fixtures, 12–15 ms/page |
| PDF raster (200 DPI) | vision-model input | 1656×2342 PNG, 226 KB, ~76 ms |
| Report PDF | CJK, tables, page breaks | 3-page A4, 46 KB, ~16–20 ms |
| Cold start | ≤ 500 ms | 642 ms first run, 331–350 ms warm |
| Installer | ≤ 25 MB | 4.6 MB DMG (16 MB `.app`) |
| Idle RAM | ≤ 200 MB | 133–136 MB |
| Windows build | runs three flows | cross-build OK (16.8 MB); runtime pending |
| SQLite | FTS5 + JSON1 + WAL | all pass against a real workspace DB |

PDFium runs through wazero: no cgo, no Chromium, no Node.
