# carbonbook final spec feedback

Review date: 2026-05-09

Reviewed file: `docs/specs/2026-05-08-carbonbook-design.md`

## Summary

The previous `extraction` lifecycle issue is mostly fixed:

- `raw_response`, `parsed_json`, and `error_json` are now nullable.
- `parsed_json` and `error_json` correctly use nullable `json_valid` checks.
- `pending` now permits no provider output yet.

One small rejected-state edge case remains.

## Finding

### `rejected` extraction should allow `error_json` without `raw_response`

Severity: Low-Medium

Current lifecycle check:

```sql
CHECK (
  (status = 'pending' AND raw_response IS NULL AND parsed_json IS NULL AND error_json IS NULL)
  OR
  (status IN ('parsed', 'review_needed') AND raw_response IS NOT NULL AND parsed_json IS NOT NULL)
  OR
  (status = 'rejected' AND raw_response IS NOT NULL AND parsed_json IS NULL)
)
```

This handles malformed model output, but it does not handle provider/network failures where there is no model response body. The schema now has `error_json` for provider error code / zod issues, so `rejected` should be valid when either raw output or structured error details exist.

Recommendation:

Use a slightly stricter lifecycle check:

```sql
CHECK (
  (status = 'pending' AND raw_response IS NULL AND parsed_json IS NULL AND error_json IS NULL)
  OR
  (status IN ('parsed', 'review_needed') AND raw_response IS NOT NULL AND parsed_json IS NOT NULL AND error_json IS NULL)
  OR
  (status = 'rejected' AND parsed_json IS NULL AND (raw_response IS NOT NULL OR error_json IS NOT NULL))
)
```

This avoids fake empty raw responses, permits true provider errors, and prevents stale `error_json` from hanging around on successful parsed/review-needed rows.

## Notes

No major product or schema architecture issue remains. After this is fixed, I would delete this feedback file and treat the spec as ready for implementation planning.
