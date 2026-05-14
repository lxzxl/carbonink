# Phase 1 Manual GUI Smoke — `phase-1d` Pre-Tag Checklist

**Date:** 2026-05-14
**Goal:** Verify the full Confirm flow end-to-end for all 5 extraction stages, exercising the real LLM, real PDF parsing, real renderer/IPC/main pipeline, and the EF Matcher v1 recommended panel.
**Outcome:** if all 5 stages pass, tag `phase-1d`.

## Why this is manual

The automated GUI smoke (Playwright E2E) was deferred — getting Playwright + Electron + TanStack Router to play nicely turned into a multi-day investment that didn't fit the Phase 1 closing budget. The E2E foundation (`tests/e2e/_setup.ts`, harness, canned data, dev-collision guard) is shipped on `main` for a future Phase 1.5 / Phase 2 sub-project to pick up. For now, the consolidated 5-stage smoke is walked manually.

## Fixtures

All 5 fixtures live in `tests/fixtures/smoke/`. They are real specimen invoices from the **Jiangsu Provincial Tax Bureau's official "数电票样式" PDF** ([jiangsu.chinatax.gov.cn](https://jiangsu.chinatax.gov.cn/attach/0/62e1ff46c4994fb1b0967c5c7869214c.pdf)) — page-extracted into per-stage files. The sample data shown on each is fake but the formats are official Chinese tax-bureau templates.

| File | Use for | Notes |
|---|---|---|
| `01-utility-fallback-template.pdf` | `china_utility.v1` | A general 普通发票 template — not specifically an electricity bill. **Recommended: replace with your own actual State Grid bill or 电费缴费通知单 PDF** for a more realistic test (it has account number, period, kWh fields populated). The fallback works if you don't have one handy but extraction confidence may be low. |
| `02-travel-and-freight-sample.pdf` | `travel.v1` **and** `freight.v1` | One page contains both 旅客运输服务电子发票 (top half) and 货物运输服务电子发票 (bottom half). When testing travel.v1, the stage prompt tells the LLM to focus on passenger transport; same for freight. Upload twice, once per stage. |
| `03-fuel-receipt-sample.pdf` | `fuel_receipt.v1` | 成品油电子发票. |
| `04-purchase-sample.pdf` | `purchase.v1` | 增值税专用发票. |

## Pre-flight

Before starting:

- [ ] `git status` shows clean working tree on `main` at the latest commit.
- [ ] `pnpm rebuild better-sqlite3` (if the last thing you did was an E2E or production build — flips the binary back to Node ABI so dev mode works).
- [ ] Confirm an OpenAI API key is reachable. The recommender hits `gpt-4o-mini`; without a key, the recommended panel stays empty (the test then verifies graceful fallback to FTS-sorted list).
- [ ] Optionally: delete `~/Library/Application Support/carbonbook/app.sqlite` if you want a fresh DB. (Or skip this — using your existing org/sources is fine; the test just adds 5 new activity_data rows.)
- [ ] Start the app: `pnpm dev`. Wait for the Electron window to appear.

## Per-stage checklist

For each of the 5 stages: upload the fixture → run extraction → review the review page → pick an emission source → verify the recommended panel → click a recommended EF → submit → verify dashboard reflects the new activity_data row.

> **Tip:** if you have a clean DB (no org yet), the wizard will run first. Complete onboarding once, then this checklist starts after the dashboard appears.

### Stage 1 — `china_utility.v1` (电网用电)

- [ ] Navigate to `/documents`.
- [ ] Pick stage **china_utility.v1** in the upload dropdown.
- [ ] Upload `tests/fixtures/smoke/01-utility-fallback-template.pdf` (or your own electricity bill).
- [ ] Wait for extraction to complete (5-15 sec; vision model is slower than text).
- [ ] Click the document row → opens `/documents/<id>` review page.
- [ ] **Verify extraction fields appear**: at minimum `supplier_name`, `amount_yuan` should be non-empty. With the template fixture, `amount_kwh` / `period_start` / `period_end` may be empty (template doesn't have real values); confidence may be `low`.
- [ ] Click **Confirm** ("确认 → 记为活动数据").
- [ ] The embedded ActivityForm appears. Pick (or create) an **emission source** with `scope=2`, `category=electricity.grid`.
- [ ] **Verify the "为本单据推荐" panel renders** with up to 3 starred EF recommendations. Each should have a Chinese reasoning sentence.
  - If the recommended panel does NOT render, the LLM call failed silently — the full filtered list should still be visible. Pick from there.
- [ ] Click the first starred EF radio.
- [ ] Form should prefill: `unit=kWh`, `amount=<from extraction>` (or empty if extraction couldn't read kWh; fill in manually e.g. `1234`).
- [ ] Click **Submit** ("记录活动").
- [ ] You should navigate to `/` (dashboard). The new activity_data row appears with a non-zero CO₂e.

### Stage 2 — `fuel_receipt.v1` (加油发票)

- [ ] Navigate back to `/documents`.
- [ ] Pick stage **fuel_receipt.v1**.
- [ ] Upload `tests/fixtures/smoke/03-fuel-receipt-sample.pdf`.
- [ ] Wait for extraction.
- [ ] Click the new document row.
- [ ] **Verify extraction fields**: `supplier_name`, `fuel_type` or `fuel_category`, `volume_l`, `amount_yuan`, `occurred_at`.
- [ ] Click Confirm → pick or create an emission source with `scope=1`, `category=fuel.mobile`.
- [ ] **Recommended panel** should surface fuel.diesel.* or similar combustion EFs (depends on which fuel_type the LLM extracted from the sample).
- [ ] Pick the first starred EF.
- [ ] Form prefills `unit=L`. Verify or fill `amount` (e.g. `50` for 50 liters).
- [ ] Submit → dashboard updates.

### Stage 3 — `freight.v1` (货运)

- [ ] Navigate to `/documents`.
- [ ] Pick stage **freight.v1**.
- [ ] Upload `tests/fixtures/smoke/02-travel-and-freight-sample.pdf` (the combined fixture — the stage prompt will tell the LLM to focus on the cargo transport invoice).
- [ ] Wait for extraction.
- [ ] Click the new row.
- [ ] **Verify**: `mode` (should be a freight mode like `road`/`rail`/`sea`/`air`), `supplier_name`, `weight_kg`, `amount_yuan`. `distance_km` is likely null (the LLM doesn't compute it — Phase 2 routing API work).
- [ ] Click Confirm → emission source with `scope=3`, `category=freight.road` (or `freight.rail`/`sea`/`air` matching what the LLM extracted).
- [ ] **Recommended panel** should surface freight.road.* EFs.
- [ ] Pick first starred EF.
- [ ] Form prefills `unit=kg` (raw weight; tonne-km conversion is Phase 2). Verify or fill `amount`.
- [ ] Submit → dashboard.

### Stage 4 — `purchase.v1` (采购发票)

- [ ] Navigate to `/documents`.
- [ ] Pick stage **purchase.v1**.
- [ ] Upload `tests/fixtures/smoke/04-purchase-sample.pdf`.
- [ ] Wait for extraction.
- [ ] Click the new row.
- [ ] **Verify**: `supplier_name`, `item_description`, `category` (should be one of `raw_material`/`component`/`consumable`/`office_supply`/`service`/`other`), `amount_yuan`. `quantity_kg` likely null for a service-style invoice.
- [ ] If the LLM extracted `category=other`, a warning banner appears below the fields explaining manual review needed — this is intended behavior.
- [ ] Click Confirm → emission source with matching category. Try `scope=3, category=purchase.service` first to exercise the prefix-match. If no EFs appear, fall back to a more specific seeded category like `purchase.service.consulting`.
- [ ] **Recommended panel** should surface purchase.* EFs. For service-style invoices the CNY-priced ones should rank well.
- [ ] Pick first starred EF.
- [ ] Form prefills `unit=CNY` (for service/no-weight) or `unit=kg` (for material). Verify and submit.
- [ ] Dashboard updates.

### Stage 5 — `travel.v1` (差旅票据)

- [ ] Navigate to `/documents`.
- [ ] Pick stage **travel.v1**.
- [ ] Upload `tests/fixtures/smoke/02-travel-and-freight-sample.pdf` (same file as freight — the stage prompt will tell the LLM to focus on the passenger transport invoice this time).
- [ ] Wait for extraction.
- [ ] Click the new row.
- [ ] **Verify**: `mode` (should be `air`/`rail`/`taxi`), `supplier_name`, `origin`, `destination`, `departure_at`. `distance_km` likely null.
- [ ] Click Confirm → emission source with `scope=3, category=travel.air` (or matching mode). The category prefix-match (commit `954cc7d`) lets `travel.air` pull in all `travel.air.*` sub-categories.
- [ ] **Recommended panel** should surface travel.air.economy.* or .business.* EFs depending on what the LLM extracted.
- [ ] Pick first starred EF.
- [ ] Form prefills `unit=passenger-km` (for air/rail) or `vehicle-km` (for taxi); `amount=1` (default placeholder since distance_km is null). Adjust manually if you want a realistic test (e.g. `1200` km for Beijing→Shanghai).
- [ ] Submit → dashboard.

## Cross-stage checks

After all 5 stages confirmed:

- [ ] Dashboard shows **5 new activity_data rows** with non-zero CO₂e contributions.
- [ ] Scope cards updated: scope 1 (fuel) + scope 2 (utility) + scope 3 (freight + purchase + travel) should all have non-zero values.
- [ ] `/activities` page lists all 5 entries with correct stage attribution.
- [ ] `/documents` page shows all 5 uploaded documents with "已抽取" / "Parsed" status chips.
- [ ] Spot-check one entry's emission factor link → the EF detail / pin status looks correct.

## Failure modes — when to NOT tag

If any of these happens, **do not tag** — file an issue or kick off a fix sub-project instead:

- ❌ Extraction returns 500 or hangs > 60 sec on any stage.
- ❌ The Confirm button doesn't reveal the ActivityForm.
- ❌ Picking an emission source doesn't fire the recommended panel query (network failure aside).
- ❌ The recommended panel never disappears even when LLM fails (should fall back to FTS list silently).
- ❌ Submitting the form doesn't create an activity_data row, OR creates one with `co2e_kg = 0` (some EF/unit mismatch is real and worth investigating).
- ❌ Dashboard scope cards don't update after a successful Confirm.

## Pass = tag

If everything above is green:

```bash
cd /Users/lxz/ws/personal/carbonbook
git tag phase-1d
git push --tags
```

That closes Phase 1 — 4 extraction stages added beyond `phase-1a`'s baseline, per-stage component split, EF Matcher v1, FTS5 + 32 seeded EFs, full IPC + ActivityForm UX. **Next:** Phase 2 (questionnaire side + MCP integration) brainstorm.

## Appendix: where the fixtures came from

The 4 official fixtures were extracted from a single Jiangsu Provincial Tax Bureau PDF [数电票样式](https://jiangsu.chinatax.gov.cn/attach/0/62e1ff46c4994fb1b0967c5c7869214c.pdf). The full PDF contains 15 invoice samples; we extracted 4 pages:

- Page 1 → `04-purchase-sample.pdf`
- Page 2 → `01-utility-fallback-template.pdf` (普通发票, used as utility fallback since electricity-specific samples are not publicly available)
- Page 4 → `02-travel-and-freight-sample.pdf` (passenger + cargo on one page)
- Page 9 → `03-fuel-receipt-sample.pdf`

Used `pdfseparate` (from poppler-utils) to extract. Reproducible: download the source PDF, run `pdfseparate -f N -l N source.pdf page-N.pdf` for the page numbers above.

For utility specifically, an actual State Grid bill produces noticeably better extraction confidence. If you have access to one (your own 电费缴费通知单), drop it into `tests/fixtures/smoke/` as `01-utility-real.pdf` and use it in place of the fallback template.
