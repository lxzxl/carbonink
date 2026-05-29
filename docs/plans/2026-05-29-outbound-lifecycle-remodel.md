# Outbound questionnaire lifecycle re-model (migration-gated remainder)

> Follow-up plan for the migration-class findings from
> [the state/UI review](../research/2026-05-29-state-ui-intuitiveness-review.md).
> The non-migration fixes already shipped (commits `d0c9281`, `a913d71`); this
> doc covers what needs a schema migration and therefore wants explicit greenlight
> before running against user data. Spec = the review doc (it has the proposed
> state table + rationale).

## Already shipped (no migration)

- **H2** — `确认全部答案` now stamps `finalized_at` on every answer (was a no-op on
  answers) + no longer regresses an exported questionnaire. (`d0c9281`)
- **H3** — shared `outboundStatusLabel()`; no route renders the raw status enum. (`d0c9281`)
- **H4 / L3** — pages unified to 披露填报; dead `nav_questionnaires` removed. (`a913d71`)
- **R1 (partial)** — `mapping` relabeled 映射中 → 草稿 so the initial state isn't
  pipeline-speak. (`a913d71`)

## Remaining (needs a migration — greenlight required)

### Task 1 — Migration 018: add `finalized` to `questionnaire.status`

SQLite can't alter a CHECK in place, so mirror migration `017`'s table-recreate:
recreate `questionnaire` with the status CHECK widened to include `'finalized'`
(purely additive — every existing value stays valid, so **no row backfill**).
Re-create the indexes + restore the FKs (`question`, `activity_data.inbound_question_id`)
exactly as `017` does. Test: existing rows survive; a row can be set to `finalized`.

**Decision needed:** the clean visible arc becomes `草稿 (mapping) → 已定稿
(finalized) → 已导出 (exported)`. That leaves `answering` and `parsing` as
*legacy/unreachable* values (kept in the CHECK for old rows, relabeled, dropped
from the primary filter). Alternative: fully re-model to `draft → in_progress →
finalized → exported` and wire `mapping→in_progress` when the first answer is
saved/generated — more correct, but touches the answer-save + generation paths
(more surface, more risk). **Recommend the additive `finalized` route** unless we
want the full re-model.

### Task 2 — Point finalize at the new state + present it

- `finalizeAnswering()` sets `status='finalized'` (instead of `'answering'`), keeping
  the stamp-all-answers behavior + the no-regress guard. Update its unit test
  (currently asserts `'answering'`).
- Add `questionnaires_status_finalized` = 已定稿 / "Finalized" to **both** message
  files; add the `finalized` case to `outboundStatusLabel()`; add it to the list
  filter (`Q_STATUSES`). Relabel/keep `answering` (填写中) for legacy rows.

### Task 3 — Action-bar emphasis (R6 / L1)

Re-evaluate after Task 2: with a real `finalized` state, decide whether the filled
primary stays `确认全部答案` or moves to Export. (H2 already made the button
meaningful, so L1 is partly mitigated — this is a judgment call, not a bug.)

### Task 4 — Enum hygiene (M3 / R5), optional, same migration window

- `activity_data.source_kind`: one table has `reused`, another doesn't.
- `organization` `boundary_kind`: one site allows `financial_control`, another
  doesn't.
Decide intentional-or-drift; if aligning, do it in a dedicated additive migration
(don't edit already-applied migration files — they're immutable history). If
intentional, add a one-line comment in each migration explaining why they differ.

## Out of scope / not bugs

- **M1** — `document.status='pending'` having no label is *intentional*:
  `resolveStatusChip` buckets `pending → review_needed` ("待审核"). No change.
- **M4** — inbound UI inline-Chinese → already tracked as v2.1 i18n debt (ROADMAP §4.5).
- **L2** — document "status" being a blend of `extraction.status` + virtual states
  is documented here; no code change.

## Verification gate (per task)

```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check <changed files>
```
vitest baseline after the shipped fixes: **934**. Don't regress.
