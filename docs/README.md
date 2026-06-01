# CarbonInk docs

What lives in git under `docs/`:

| Path | What |
|---|---|
| [`conventions/`](conventions/) | Repo conventions, split out of the always-loaded `AGENTS.md` — "how we build here" |
| [`ROADMAP.md`](ROADMAP.md) | Post-launch ideas (no schedule, no commitment) |

## Conventions (read these for "how we build here")

- [repo-layout.md](conventions/repo-layout.md) — monorepo, scripts, native deps, brand, Electron pin
- [cloud-deploy.md](conventions/cloud-deploy.md) — static marketing site on Workers, single-domain routing
- [ui-patterns.md](conventions/ui-patterns.md) — scroll containment, list rows, button hierarchy
- [testing-and-i18n.md](conventions/testing-and-i18n.md) — vitest baseline, biome debt, ABI rebuild, i18n key sync

## Per-feature design docs are local-only

Specs (`specs/`), implementation plans (`plans/`), research spikes
(`research/`), release notes (`release-notes/`), backlogs (`todo/`), and retired
scaffolding (`archive/`) are **kept locally but not tracked in git** (see the
`docs/` entries in `.gitignore`). They're the development-process trail —
brainstorm → spec → plan — not part of the shipped, open-source project. The
living references above (`conventions/` + `ROADMAP.md`) are what stays in the
public repo.

The workflow that produces them is unchanged: brainstorm → spec (`docs/specs/`)
→ plan (`docs/plans/`) → implement. The files just don't get committed.
