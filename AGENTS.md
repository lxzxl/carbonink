# CarbonInk — Agent Conventions

Local conventions for this repo. Skills and plans build on top of these; when a
skill conflicts with this file, this file wins (per the user's explicit
instructions). The detailed guidance lives in `docs/conventions/` — **this file
is the always-loaded index + non-negotiables**; everything else is linked and
read on demand.

## Non-negotiables (read before any change)

- **English is the written language of this repo.** Docs (everything under
  `docs/**`, including local-only specs/plans/research), code comments, and git
  commit messages MUST be English. Conversation with the user may be Chinese.
  Product-facing strings go through `app/locales/{en,zh-CN}.yaml` with en +
  zh-CN parity (see the i18n rule below).
- **Git: commit freely without asking; push only when explicitly allowed.**
  Never force-push, never run destructive git. If on the default branch, branch
  first.
- **Tests and checks must stay green.** Before landing changes to `app/` or
  `cloud/web/`, run:
  `cd app && go tool nsgo check && go vet ./... && go test ./... && go tool nsgo test ./internal/app && go tool nsgo test .`
  and `pnpm cloud:build:web`.
- **No licensing.** CarbonInk is free & open-source (MIT) — there is no license
  gate, activation, account, or payment. Don't reintroduce one.
- **i18n keys go in BOTH `app/locales/en.yaml` + `app/locales/zh-CN.yaml`** —
  same key set, same commit (checked by `app/locales/catalog_test.go`, bindings
  regenerated via `go tool nsgo check`).
- **`audit_event` payloads carry no prompt content** — only tool names, IDs,
  counts, decision flags. `organizationId` is injected server-side, never
  user-supplied.
- **Workflow: brainstorm → spec → plan → implement.** Specs land in
  `docs/specs/`, plans in `docs/plans/` — both **local-only / gitignored** (the
  dev trail isn't tracked), one per feature.

## Where things live

| Path | What |
|---|---|
| `app/` | CarbonInk 2.0 native desktop app (NSGo / Go) — UI in `internal/app`, domain & storage in `internal/*`, `locales/{en,zh-CN}.yaml` |
| `cloud/web/` | Astro **static marketing site** (`/`, `/download`, `/privacy`, `/guides/*` + `/zh/` mirrors; guides ship as en+zh pairs), Workers + Static Assets |
| `docs/` | Tracked conventions (`docs/conventions/`) and local-only design trail |

```bash
pnpm app:dev              # cd app && go tool nsgo dev . (hot-reloading native window)
pnpm app:check            # cd app && go tool nsgo check
pnpm app:test             # cd app && go test ./... && go tool nsgo test .
pnpm app:build            # cd app && go tool nsgo build -target macos_arm64
pnpm cloud:dev:web        # pnpm --filter @carbonink-cloud/web dev
pnpm cloud:preview:web    # pnpm --filter @carbonink-cloud/web preview
pnpm cloud:build:web      # pnpm --filter @carbonink-cloud/web build
```

## Detailed conventions → `docs/conventions/`

| Topic | Doc |
|---|---|
| Monorepo layout, scripts, brand | [repo-layout.md](docs/conventions/repo-layout.md) |
| Cloud (Workers everywhere, single-domain routing, gotchas) | [cloud-deploy.md](docs/conventions/cloud-deploy.md) |
| Design system & native UI conventions | [DESIGN.md](DESIGN.md) / [app/DESIGN.md](app/DESIGN.md) |
| Testing + i18n discipline | [testing-and-i18n.md](docs/conventions/testing-and-i18n.md) |

Brand palette + "don't reintroduce sky-blue" rule: [cloud/AGENTS.md](cloud/AGENTS.md).

## Docs map

- [`docs/README.md`](docs/README.md) — docs index
- [`docs/conventions/`](docs/conventions/) — how-we-build references (tracked)
- `docs/ROADMAP.md` — post-launch ideas, **local-only** (gitignored)
- `docs/{specs,plans,research,release-notes,todo,archive}/` — per-feature design +
  implementation trail, **local-only** (gitignored; not in the public repo)
