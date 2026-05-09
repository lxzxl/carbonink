# carbonbook final spec feedback

Review date: 2026-05-09

Reviewed file: `docs/specs/2026-05-08-carbonbook-design.md`

## Summary

The previous feedback has been addressed:

- Headless MCP now covers unpaired and paired-but-not-trusted clients.
- JWT example is valid JSON and explains `grace_until` below the code block.
- DB reproducibility is much stronger with `calculation_snapshot_line`.
- `activity_data.site_id` is now protected by a composite FK to `emission_source(id, site_id)`.
- `PRAGMA foreign_keys = ON`, JSON checks, indexes, audit triggers, signature versioning, typed answer refs, and CBAM row allocation were added.

Two smaller DB hardening issues remain.

## Findings

### 1. `extraction.raw_response` should not require valid JSON

Severity: Medium

Current schema:

```sql
raw_response TEXT NOT NULL CHECK(json_valid(raw_response))
```

This is too strict for the raw model response. In failure cases, retries, provider bugs, partial streaming output, or malformed JSON from the model, we still want to persist the raw response for audit/debugging while marking the extraction as `rejected` or `review_needed`.

Recommendation:

Keep `parsed_json` as valid JSON, but make `raw_response` unconstrained text:

```sql
raw_response TEXT NOT NULL,
parsed_json  TEXT NOT NULL CHECK(json_valid(parsed_json)),
```

If structured provider metadata is needed, add a separate `raw_metadata TEXT CHECK(raw_metadata IS NULL OR json_valid(raw_metadata))`.

### 2. `answer` typed source columns need a DB-level exclusivity check

Severity: Medium

The schema replaced polymorphic `source_ref` with typed nullable FK columns, which is good. But the current comment says "service layer 校验只填一列"; DB does not enforce it.

Current source columns:

- `source_calculation_snapshot_id`
- `source_activity_data_id`
- `source_company_profile_key`
- `source_narrative_bank_id`

Risk:

Rows can accidentally have multiple source refs or none despite `source_kind` claiming `mapped_inventory` / `ai_suggested`. That weakens answer provenance.

Recommendation:

Add a `CHECK` that enforces exactly one source ref when `source_kind != 'manual'`, and zero or one source ref for manual answers depending on desired behavior. Example:

```sql
CHECK (
  (
    source_kind = 'manual'
    AND source_calculation_snapshot_id IS NULL
    AND source_activity_data_id IS NULL
    AND source_company_profile_key IS NULL
    AND source_narrative_bank_id IS NULL
  )
  OR
  (
    source_kind <> 'manual'
    AND (
      (source_calculation_snapshot_id IS NOT NULL) +
      (source_activity_data_id IS NOT NULL) +
      (source_company_profile_key IS NOT NULL) +
      (source_narrative_bank_id IS NOT NULL)
    ) = 1
  )
)
```

If manual answers may cite a source, relax the manual branch to `<= 1` instead of `= 0`.

## Notes

No major product or schema architecture issue remains. After these two are fixed, I would delete this feedback file and treat the spec as ready for implementation planning.
