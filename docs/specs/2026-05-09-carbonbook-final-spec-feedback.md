# carbonbook final spec feedback

Review date: 2026-05-09

Reviewed file: `docs/specs/2026-05-08-carbonbook-design.md`

## Summary

The previous 5 findings have been addressed:

- Headless MCP now explicitly rejects resources / tools / prompts before pairing.
- The ER diagram now shows `activity_data -> pinned_emission_factor`.
- The JWT example now includes `grace_until`.
- The "no third-party API" statement is scoped to public/cloud REST APIs and no longer conflicts with local MCP.
- CBAM and OAuth are now separated into v1.0 stable vs v1.1 / experimental scope.

I would keep this feedback file for one more pass. Besides two small consistency issues, the database design still needs several implementation guards before migrations are created.

## Findings

### 1. Headless MCP does not define "paired but not trusted"

Severity: Medium

§9 now defines:

- no pairing history: reject all MCP requests
- trusted pairing token: allow resources + RO tools
- write tool + GUI not running: reject
- write tool + GUI running: proxy to GUI confirm

But the settings model has a distinct "trusted client" concept: "只信任配对时勾过 trust this client". That implies a client can be paired but not trusted. The headless table does not define that state.

Recommendation:

Add one row:

| **有配对 token 但未标记 trusted** | Headless stdio 拒绝所有 requests，返回 `{ permission_required: true, hint: "Open carbonbook GUI to use this client" }`。GUI / SSE 模式下仍可按常规 confirm 策略使用。 |

This preserves the security boundary: headless access requires explicit trust, not merely successful pairing.

### 2. JWT sample is fenced as JSON but contains a comment

Severity: Low

The JWT example is in a `json` code fence but includes:

```json
"grace_until": 1780828000,        // = expires_at + 30 days
```

That is not valid JSON. It is minor, but this spec is likely to be copied into code/tests/docs later.

Recommendation:

Either remove the inline comment:

```json
"grace_until": 1780828000,
```

Or change the fence to `js` / `jsonc`. Since this is a JWT payload example, valid JSON is cleaner.

## Database Design Findings

### 3. `calculation_snapshot` does not yet guarantee report reproducibility

Severity: High

Current design stores totals and `activity_row_ids`, but activity rows can later be edited or physically deleted. If that happens, a frozen report cannot be reconstructed from row ids alone.

Recommendation:

Add a detail table, e.g. `calculation_snapshot_line`, that freezes every included activity row at report time:

- original `activity_data_id`
- site / source / period ids and names at freeze time
- occurred date range
- amount, unit, converted amount, EF input unit
- EF composite key and pinned EF coefficient values
- computed CO2e and per-scope/category classification
- extraction/document refs where relevant

Keep `calculation_snapshot` as the header/summary table, but make snapshot lines the audit-grade source of truth.

### 4. `activity_data.site_id` can diverge from `emission_source.site_id`

Severity: High

`activity_data` stores both `site_id` and `emission_source_id`, while `emission_source` also belongs to a `site_id`. Without a constraint, activity rows can point to Site A while their source belongs to Site B.

Recommendation:

Pick one:

- Remove `activity_data.site_id` and derive site through `emission_source_id`.
- Or add a composite FK by making `emission_source(id, site_id)` unique and referencing `(emission_source_id, site_id)` from `activity_data`.

The second option keeps query ergonomics while preserving DB-level integrity.

### 5. SQLite foreign keys must be explicitly enabled

Severity: High

The design relies heavily on FK integrity, especially `activity_data -> pinned_emission_factor`. SQLite does not enforce foreign keys unless each connection enables them.

Recommendation:

Add a DB initialization rule:

```sql
PRAGMA foreign_keys = ON;
```

Every `better-sqlite3` connection, migration runner, and test DB must set it. Add a smoke test that inserting an invalid FK fails.

### 6. `question_mapping.mapping_kind = 'sql'` is too permissive for v1

Severity: Medium-High

Allowing raw SQL in `mapping_payload` creates several risks:

- schema migrations break saved mappings
- SQL injection / prompt injection paths become harder to reason about
- arbitrary local reads become possible if the query executor is not heavily sandboxed
- MCP and questionnaire automation inherit this surface area

Recommendation:

For v1, remove raw SQL as a mapping kind. Use:

- `inventory_path`
- `literal`
- `manual`
- a small allowlisted query-template DSL with typed parameters

If raw SQL is ever reintroduced, it should be read-only, parameterized, table allowlisted, and never LLM-authored without user review.

### 7. Add unique constraints and indexes before implementation

Severity: Medium

The current schema has only a small subset of the indexes needed for correctness and performance.

Recommended additions:

- `UNIQUE(document_id, prompt_version, llm_provider, llm_model)` on `extraction` to enforce cache semantics.
- `UNIQUE(questionnaire_id, position)` where position is known.
- Index `question(question_signature)`.
- Decide whether `answer(question_id)` is one-answer-per-question; if yes, add `UNIQUE(question_id)`.
- Index `activity_data(ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version)` for EF impact / rebind audits.
- Index `audit_event(occurred_at)` and possibly `(event_kind, occurred_at)`.
- Index `calculation_snapshot(reporting_period_id, frozen_at)`.

### 8. JSON columns should be valid JSON, not just named `JSON`

Severity: Medium

SQLite does not enforce JSON validity merely because a column is declared `JSON`.

Recommendation:

Use `TEXT CHECK(json_valid(column))` for fields like:

- `default_ef_query`
- `parsed_json`
- `mapping_payload`
- `ef_dataset_versions`
- `scope3_kg_by_cat`
- `activity_row_ids`
- `report_metadata`
- `audit_event.payload`

For nullable JSON, use `CHECK(column IS NULL OR json_valid(column))`.

### 9. Append-only audit log needs enforcement

Severity: Medium

`audit_event` is described as append-only, but the schema does not prevent update/delete.

Recommendation:

Add SQLite triggers that abort updates/deletes on `audit_event`, or state clearly that append-only is service-layer-only. DB triggers are preferable for audit credibility.

### 10. Polymorphic references need hardening

Severity: Medium

`answer.source_ref` stores references like `calculation_snapshot:abc123` or `activity_data:xyz`. This cannot be enforced by FK and may break if referenced rows are changed or deleted.

Recommendation:

Either:

- split source references into typed nullable FK columns, or
- create an `answer_source` table with typed columns and copied source summary fields.

At minimum, store a small immutable source snapshot beside the reference so exported answers remain explainable.

### 11. `question_signature` should be versioned

Severity: Low-Medium

The signature algorithm is described procedurally. If normalization changes later, old mappings become difficult to interpret.

Recommendation:

Add:

- `signature_version`
- `normalized_text`

Either to `question`, `question_mapping`, or both. Include version in mapping lookup logic.

### 12. CBAM source streams need row-level allocation when §7 is implemented

Severity: Low for v1.0, Medium for v1.1

§7 says CBAM source streams reference the same `activity_data`, but the current CBAM schema references `emission_source_id`, not actual activity rows. That works for broad aggregation but not precise product/process allocation.

Recommendation for v1.1:

Add a join table:

```sql
CREATE TABLE cbam_source_stream_activity (
  stream_id TEXT NOT NULL REFERENCES cbam_source_stream(id),
  activity_data_id TEXT NOT NULL REFERENCES activity_data(id),
  allocation_share REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (stream_id, activity_data_id)
);
```

This keeps the "activity_data 不复制" rule while allowing precise allocation.

## Notes

No major product architecture issue remains. The remaining work is mostly database integrity, audit reproducibility, and implementation hardening.
