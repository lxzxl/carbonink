# Testing + i18n discipline

> Detailed reference for `AGENTS.md` → "Non-negotiables". Linked, not
> auto-loaded; the one-line rules live in AGENTS.md, the why/how is here.

## i18n

All user-facing desktop strings go through NSGo ICU YAML catalogs
(`app/locales/en.yaml` + `app/locales/zh-CN.yaml`). Both language files must
keep the exact same key set — new features add keys to BOTH files in the same
commit.

- `app/locales/catalog_test.go` verifies key parity and non-empty English
  messages.
- `cd app && go tool nsgo check` regenerates `app/locales/catalog_gen.go` and
  validates the module and targets.

## Test discipline

Before committing changes to `app/` or `cloud/web/`:

```bash
cd app
go tool nsgo check
go vet ./...
go test ./...
go tool nsgo test ./internal/app
go tool nsgo test .
```

And for the marketing site:

```bash
pnpm cloud:build:web
```

- Tests never read the developer's local data directory: `app/main_test.go` sets
  `CARBONINK_NO_LEGACY_IMPORT=1` and UI tests use `CARBONINK_TEST_DB` with
  isolated temp fixtures.
- Pure-Go packages are also verified on Linux (`go test` excluding `internal/app`,
  `internal/spike`, and root `main`, plus `go build ./...`) in CI.

## Audit-event hygiene (security invariant)

When writing `audit_event` rows, the payload must NOT contain prompt
content — only tool names, IDs, counts, and decision-path flags.
`organizationId` is injected into tools server-side; it is never
user-supplied. (Carried here because it's a cross-cutting rule that's
easy to violate when adding a new audited action.)
