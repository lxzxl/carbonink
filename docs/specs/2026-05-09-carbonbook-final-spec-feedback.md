# carbonbook final spec feedback

Review date: 2026-05-09

Reviewed file: `docs/specs/2026-05-08-carbonbook-design.md`

## Summary

The previous two findings have been addressed:

- `extraction.raw_response` is now unconstrained text instead of requiring valid JSON.
- `answer` now has a DB-level source exclusivity `CHECK`.

One remaining database lifecycle issue should be fixed before deleting this feedback file.

## Finding

### `extraction` status lifecycle conflicts with `NOT NULL` fields

Severity: Medium

Current schema allows statuses:

```sql
status TEXT NOT NULL CHECK(status IN ('pending', 'parsed', 'review_needed', 'rejected'))
```

But the same table requires:

```sql
raw_response TEXT NOT NULL,
parsed_json  TEXT NOT NULL CHECK(json_valid(parsed_json))
```

This conflicts with at least two lifecycle states:

- `pending`: before the provider returns, there is no `raw_response` and no `parsed_json`.
- `rejected`: if the model returns malformed output or zod validation fails, there may be a `raw_response` but no validated `parsed_json`.

Using empty strings or `{}` would satisfy the database but weaken the meaning of the columns, especially because `parsed_json` is documented as "zod 校验通过后的结构化 JSON".

Recommendation:

Make `raw_response` and `parsed_json` nullable, and enforce validity by status:

```sql
raw_response TEXT,
parsed_json  TEXT CHECK(parsed_json IS NULL OR json_valid(parsed_json)),
status        TEXT NOT NULL CHECK(status IN ('pending', 'parsed', 'review_needed', 'rejected')),
CHECK (
  (status = 'pending' AND raw_response IS NULL AND parsed_json IS NULL)
  OR
  (status IN ('parsed', 'review_needed') AND raw_response IS NOT NULL AND parsed_json IS NOT NULL)
  OR
  (status = 'rejected' AND raw_response IS NOT NULL)
)
```

If rejected records need structured error details, add:

```sql
error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json))
```

This keeps the table honest across the whole extraction lifecycle.

## Notes

No major product or schema architecture issue remains. After this is fixed, I would delete this feedback file and treat the spec as ready for implementation planning.
