# CarbonInk — Agent Conventions

Local conventions for this repo. Skills and plans build on top of these; when a
skill conflicts with this file, this file wins (per the user's explicit
instructions). The detailed guidance lives in `docs/conventions/` — **this file
is the always-loaded index + non-negotiables**; everything else is linked and
read on demand.

## Non-negotiables (read before any change)

- **Git: commit freely without asking; push only when explicitly allowed.**
  Never force-push, never run destructive git. If on the default branch, branch
  first.
- **Tests must not regress.** `pnpm desktop:test` is at **1113/1113** (2026-07-22,
  after the S4-S5 slices (TCFD xlsx + white-label logo) landed). Don't land a commit that drops the
  count.
- **No licensing.** CarbonInk is free & open-source (MIT) — there is no license
  gate, activation, account, or payment. Don't reintroduce one.
- **Biome errors stay at ZERO.** The historic ~940-error debt was cleared
  2026-07-22 (`pnpm exec biome check .` in desktop/ reports 0 errors; the
  remaining ~170 warnings/infos — mostly noNonNullAssertion in tests — are
  accepted style residue, don't churn them). New code MUST pass a scoped
  `biome check <changed files>` with no NEW errors or warnings.
- **i18n keys go in BOTH `messages/en.json` + `messages/zh-CN.json`** — same key
  set, same commit. (Inbound v2.0's inline Chinese is acknowledged debt, not a
  pattern to copy.)
- **`audit_event` payloads carry no prompt content** — only tool names, IDs,
  counts, decision flags. `organizationId` is injected server-side, never
  user-supplied.
- **After any `electron-rebuild` (e.g. `pnpm build`), vitest breaks** with
  `NODE_MODULE_VERSION 145 vs 137`. Fix: `pnpm --filter carbonink run rebuild:node`.
  Environmental, never a regression.
- **Electron is pinned at `^41.5.1`** — do not upgrade (better-sqlite3 v8 blocker).
- **Workflow: brainstorm → spec → plan → implement.** Specs land in
  `docs/specs/`, plans in `docs/plans/` — both **local-only / gitignored** (the
  dev trail isn't tracked), one per feature.

## Where things live

pnpm workspace; two apps share `docs/` + tooling:

| Path | What |
|---|---|
| `desktop/` | Electron app (`carbonink`) — `src/{main,preload,renderer,shared}`, `tests/` (vitest) |
| `cloud/worker/` | `@carbonink-cloud/worker` — old license/payments API. **Retired** (not deployed); code + tests kept for history |
| `cloud/web/` | Astro **static marketing site** (`/`, `/download`, `/privacy`, `/guides/*` + `/zh/` mirrors; guides ship as en+zh pairs), Workers + Static Assets |
| `cloud/packages/shared/` | `@carbonink-cloud/shared` — Zod + JWT-claim types (lockstep with desktop) |

```bash
pnpm test                 # all packages          pnpm desktop:test / desktop:typecheck
pnpm --filter carbonink dev                       # electron-vite dev --watch (renderer HMR + main/preload hot-restart)
pnpm --filter @carbonink-cloud/web build
```

## Detailed conventions → `docs/conventions/`

| Topic | Doc |
|---|---|
| Monorepo layout, scripts, native deps, brand, Electron pin | [repo-layout.md](docs/conventions/repo-layout.md) |
| Cloud (Workers everywhere, single-domain routing, gotchas) | [cloud-deploy.md](docs/conventions/cloud-deploy.md) |
| UI patterns (scroll containment, list rows, button hierarchy) | [ui-patterns.md](docs/conventions/ui-patterns.md) |
| Testing + i18n discipline (full detail + ABI rebuild) | [testing-and-i18n.md](docs/conventions/testing-and-i18n.md) |

Brand palette + "don't reintroduce sky-blue" rule: `cloud/CLAUDE.md`.

## Docs map

- [`docs/README.md`](docs/README.md) — docs index
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — post-launch ideas
- [`docs/conventions/`](docs/conventions/) — how-we-build references (tracked)
- `docs/{specs,plans,research,release-notes,todo,archive}/` — per-feature design +
  implementation trail, **local-only** (gitignored; not in the public repo)
