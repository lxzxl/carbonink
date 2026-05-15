# Excel Library Trade-offs — exceljs vs alternatives

**Date:** 2026-05-15
**Status:** Decision recorded; revisit when conditions below trigger.
**Decision:** Stay on `exceljs` for Phase 2.2.x. Reconsider before Phase 3 production hardening, or sooner if a triggering condition fires.

## Context

Phase 2.2a (questionnaire upload + parse) shipped using `exceljs` (`feat(excel)` at commit `6d44c6b`). Phase 2.2c will need read-modify-write (load original CDP `.xlsx`, fill answer cells, save preserving formatting). The question came up: is `exceljs` outdated? Are there modern WASM alternatives worth switching to now while the cost is small?

## Findings (audited 2026-05-15)

### exceljs current state

- Last stable: **4.4.0, ~2 years ago**; zero npm releases in past 12 months.
- Package-quality trackers (Cloudsmith Navigator, Snyk Advisor) classify as **Inactive**.
- **Not formally deprecated.** A new maintainer surfaced on the issue tracker claiming to revive but no shipped releases yet.
- Community fork **`@protobi/exceljs`** carries active security maintenance — latest `4.4.0-protobi.10` in 2026/05. API-compatible drop-in replacement.

### Alternatives by use-case fit

Our workload is **read → modify specific answer cells → write back preserving original formatting**. Read-only or write-from-scratch libraries don't fit.

| Library | Reads | Modify+write | npm pkg | Maintained | Fit |
|---|---|---|---|---|---|
| `exceljs` 4.4.0 | ✅ | ✅ | ✅ | Inactive | **In use — works** |
| `@protobi/exceljs` fork | ✅ | ✅ | ✅ | Active (security) | Drop-in if we want patches |
| `xlsx-wasm-parser` (calamine via WASM) | ✅ fast | ❌ read-only | ✅ | Active | No — can't write |
| `xlsx-fire` (calamine + streaming WASM) | ✅ | ❌ read-only | ✅ | New | No — can't write |
| `wasm-xlsxwriter` (rust_xlsxwriter WASM) | ❌ | ⚠️ write-from-scratch only | ✅ | Active | No — can't modify existing |
| `umya-spreadsheet` (Rust + `js` feature) | ✅ | ✅ | ❌ no pre-built npm; user compiles + bundles | Semi-active (last tag 2023-12) | Workable but build cost |
| `excelize-wasm` (Go excelize → WASM) | ✅ | ✅ | ✅ | Active | **Best WASM option if migrating** |
| SheetJS / `xlsx` | ✅ | ✅ | ⚠️ Community ed. on CDN, not npm; Pro ed. commercial | Active | Most popular non-WASM; license complexity |

### Cost to migrate now

- Rewrite `ExcelParser.parse` (~70 LOC) against new lib + adapt tests (~4 unit tests)
- Build whatever Phase 2.2c needs against the same new lib (write-back hasn't shipped yet — picking now would actually be cheaper than picking later)
- Risk: unknown edge cases (CDP questionnaire format-preservation quirks) until hands-on
- Bundle size considerations: WASM libs add ~200-500 KB to the renderer or main process

### Why not migrate now

1. **It works.** ExcelParser passes its tests; the questionnaire pipeline is green.
2. **Scale matches us.** CDP supplier questionnaires are <500 KB / <2000 cells. The "blazingly fast" pitch of WASM libraries solves a problem we don't have.
3. **"Inactive" ≠ broken.** No known security CVEs, no known bugs that block our use case. exceljs's `wb.xlsx.load/write` API has been stable for years.
4. **Cheap to revisit.** ExcelParser is one file (~70 LOC) with a narrow public surface — `parse(bytes) → ParsedCell[]`. Swapping libraries is a single-day task whenever we want.

## Decision

**Stay on `exceljs` 4.4.0** for Phase 2.2.x.

## Triggers to revisit

Switch when any of these fire:

1. **Security CVE** lands against exceljs without an upstream fix in 30 days. Fastest mitigation: swap to `@protobi/exceljs` (zero code change).
2. **Real bug** blocks a feature — e.g., format-preservation fails on a customer's real CDP file when we ship 2.2c.
3. **Scale shifts** — if we ever process workbooks > 10 MB / 100K cells (extremely unlikely for our domain).
4. **Phase 3 production hardening** — checkpoint review where "stale dependency with no upstream releases for 18+ months" warrants a planned migration.

## Migration path (when needed)

**Recommended target: `excelize-wasm`.**

- Go-via-WASM, but the JS API is idiomatic and the npm package is current.
- Read + modify + write are all first-class; no need to glue multiple libs.
- Active maintenance (build badge green, issue turnaround reasonable).
- Bundle size larger than calamine-based options (Go WASM is heavier than Rust WASM) but a single ~500 KB hit absorbed at install time for an Electron desktop app is fine.

**Backup target: `@protobi/exceljs`.**

- Zero-effort migration (API identical).
- Only addresses the maintenance signal; doesn't gain anything else.
- Reasonable if the trigger is "exceljs vulnerable, need a patched fork now."

## What changes when we migrate

- `src/main/excel/parser.ts` — replace the `exceljs`-specific cell-walk with the new lib's iterator.
- `tests/main/excel/parser.test.ts` — the test fixture-builder swaps too (`buildXlsx` helper).
- Whatever Phase 2.2c builds for write-back gets routed through the same lib.
- IPC + service shapes stay unchanged. `ParsedCell` is our own type, not the lib's.

That's it. The `ExcelParser` boundary insulates the rest of the codebase from this choice.

## Sources

- [exceljs Cloudsmith Navigator status](https://cloudsmith.com/navigator/npm/exceljs)
- [exceljs Community Fork discussion (GitHub #2987)](https://github.com/exceljs/exceljs/discussions/2987)
- [@protobi/exceljs npm](https://www.npmjs.com/package/@protobi/exceljs)
- [xlsx-wasm-parser (calamine WASM)](https://github.com/remirth/xlsx-wasm-parser)
- [wasm-xlsxwriter (rust_xlsxwriter WASM) npm](https://www.npmjs.com/package/wasm-xlsxwriter)
- [umya-spreadsheet](https://github.com/MathNya/umya-spreadsheet)
- [excelize-wasm (Go excelize via WASM)](https://github.com/xuri/excelize-wasm)
- [SheetJS vs ExcelJS vs node-xlsx (2026 guide)](https://www.pkgpulse.com/guides/sheetjs-vs-exceljs-vs-node-xlsx-excel-files-node-2026)
