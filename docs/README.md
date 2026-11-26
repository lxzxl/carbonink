# CarbonInk docs

What lives in git under `docs/`:

| Path | What |
|---|---|
| [`conventions/`](conventions/) | Repo conventions, split out of the always-loaded `AGENTS.md` — "how we build here" |

## Conventions (read these for "how we build here")

- [repo-layout.md](conventions/repo-layout.md) — monorepo layout, scripts, brand
- [cloud-deploy.md](conventions/cloud-deploy.md) — static marketing site on Workers, single-domain routing
- [testing-and-i18n.md](conventions/testing-and-i18n.md) — Go / `nsgotest` suites, `cloud:build:web`, i18n YAML catalog parity, audit-event hygiene

For desktop UI design tokens and native layout rules, see [`DESIGN.md`](../DESIGN.md) and [`app/DESIGN.md`](../app/DESIGN.md).

## Per-feature design docs are local-only

Specs (`specs/`), implementation plans (`plans/`), research spikes
(`research/`), release notes (`release-notes/`), backlogs (`todo/`), retired
scaffolding (`archive/`), and the roadmap (`ROADMAP.md`) are **kept locally but
not tracked in git** (see the `docs/` entries in `.gitignore`). They're the
development-process trail — brainstorm → spec → plan — not part of the shipped,
open-source project. The living references above (`conventions/`) are what
stays in the public repo.

The workflow that produces them is unchanged: brainstorm → spec (`docs/specs/`)
→ plan (`docs/plans/`) → implement. The files just don't get committed.
