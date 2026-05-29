# CarbonInk docs

Map of the `docs/` tree. **For *status* (what's shipped vs. in progress), see
[ROADMAP.md](ROADMAP.md)** — it's the single source of truth. This file is the
*navigation* index.

## Layout

| Dir | What's in it |
|---|---|
| [`conventions/`](conventions/) | Repo conventions, split out of the always-loaded `AGENTS.md` |
| `specs/` | Per-feature design docs (the "what + why"), one per feature, `YYYY-MM-DD-<topic>(-design).md` |
| `plans/` | Per-feature implementation plans (the "how", task-by-task), paired with a spec by date+topic |
| `research/` | Standalone investigations / spikes |
| `release-notes/` | Per-version shipped summaries |
| `todo/` | Open backlogs (not yet specced) |
| `archive/` | Retired phase-0/phase-1 scaffolding, kept for history |
| `ROADMAP.md` | Status of every workstream |

**Naming**: a feature usually has both a spec (`specs/…-design.md`) and a plan
(`plans/…​.md`) sharing a date + topic slug. The plan's header links its spec.

## Conventions (read these for "how we build here")

- [repo-layout.md](conventions/repo-layout.md) — monorepo, scripts, native deps, brand, Electron pin
- [cloud-deploy.md](conventions/cloud-deploy.md) — Workers everywhere, single-domain routing, gotchas
- [ui-patterns.md](conventions/ui-patterns.md) — scroll containment, list rows, button hierarchy
- [testing-and-i18n.md](conventions/testing-and-i18n.md) — vitest baseline, biome debt, ABI rebuild, i18n key sync

## Workstreams (plans, newest first)

**v2.0 inbound + agent answer-gen (2026-05-27, current)**
- [inbound-questionnaire-cat1](plans/2026-05-27-inbound-questionnaire-cat1.md) — supplier disclosures → Scope 3 Cat 1 activity data
- [pi-agent-answer-generation](plans/2026-05-27-pi-agent-answer-generation.md) — agentic outbound answer generation

**Pi / MCP integration (2026-05-26)**
- [pi-mcp-integration-ux](plans/2026-05-26-pi-mcp-integration-ux.md) · [mcp-skill-installer](plans/2026-05-26-mcp-skill-installer.md) · [pi-ai-llm-client-replacement](plans/2026-05-26-pi-ai-llm-client-replacement.md)

**Post-launch (2026-05-25)**
- [undo-redo](plans/2026-05-25-carbonbook-undo-redo.md)

**Launch + cloud (2026-05-21..22)**
- [phase-5-launch](plans/2026-05-22-carbonbook-phase-5-launch.md) · [phase-5-launch-readiness](plans/2026-05-21-carbonbook-phase-5-launch-readiness.md) · [cloud-impl](plans/2026-05-22-carbonbook-cloud-impl.md) · [phase-4-license-client-core](plans/2026-05-20-carbonbook-phase-4-license-client-core.md) · [ui-redesign](plans/2026-05-21-carbonbook-ui-redesign.md)

**Reporting + audit + EF rebind (2026-05-20)**
- [iso-14064-1-report](plans/2026-05-20-carbonbook-iso-14064-1-report.md) · [audit-event-ui](plans/2026-05-20-carbonbook-audit-event-ui.md) · [ef-rebind-ui](plans/2026-05-20-carbonbook-ef-rebind-ui.md) · [questionnaire-pdf-export](plans/2026-05-20-carbonbook-questionnaire-pdf-export.md)

**Questionnaire / answer-gen, outbound (2026-05-15..19)**
- [questionnaire-extract](plans/2026-05-15-carbonbook-questionnaire-extract.md) · [questionnaire-auto-answer](plans/2026-05-15-carbonbook-questionnaire-auto-answer.md) · [answer-effect-step2](plans/2026-05-16-answer-effect-step2.md) · [answer-effect-step3](plans/2026-05-17-answer-effect-step3.md) · [answer-export](plans/2026-05-17-answer-export.md) · [answer-generator-three-paths](plans/2026-05-19-answer-generator-three-paths.md) · [question-mapping-reuse](plans/2026-05-19-question-mapping-reuse.md)

**Routing + MCP server + e2e infra (2026-05-18..19)**
- [routing-api](plans/2026-05-18-routing-api.md) · [mcp-server-v1](plans/2026-05-19-mcp-server-v1.md) · [playwright-e2e](plans/2026-05-14-carbonbook-playwright-e2e.md) · [playwright-e2e-refresh](plans/2026-05-18-playwright-e2e-refresh.md)

**Phase 1 — first CO₂e + AI extraction + per-stage (2026-05-11..15)**
- [phase-1a-first-co2e](plans/2026-05-11-carbonbook-phase-1a-first-co2e.md) · [phase-1b-ai-extraction](plans/2026-05-12-carbonbook-phase-1b-ai-extraction.md) · [phase-1c-ocr-fallback](plans/2026-05-12-carbonbook-phase-1c-ocr-fallback.md) · [ef-matcher-v1](plans/2026-05-14-carbonbook-ef-matcher-v1.md) · [auto-classify](plans/2026-05-15-carbonbook-auto-classify.md)
- per-stage: [freight](plans/2026-05-13-carbonbook-freight-stage.md) · [fuel-receipt](plans/2026-05-13-carbonbook-fuel-receipt-stage.md) · [purchase](plans/2026-05-13-carbonbook-purchase-stage.md) · [travel](plans/2026-05-13-carbonbook-travel-stage.md) · [component-split](plans/2026-05-14-carbonbook-per-stage-component-split.md)

**Phase 0 — foundation (2026-05-09..11)**
- [phase-0-foundation](plans/2026-05-09-carbonbook-phase-0-foundation.md) · [ui-baseline](plans/2026-05-11-carbonbook-ui-baseline.md)
- (granular phase-0 task breakdown retired to [`archive/`](archive/))

## Research

- [state-ui-intuitiveness-review](research/2026-05-29-state-ui-intuitiveness-review.md) — audit of every status state machine + UI flow, with prioritized fixes
- [electron-42-upgrade-blocker](research/2026-05-25-electron-42-upgrade-blocker.md) — why Electron is pinned at 41
- [pi-integration-spike](research/2026-05-26-pi-integration-spike.md) · [effect-ts-adoption](research/2026-05-15-effect-ts-adoption.md) · [excel-library-tradeoffs](research/2026-05-15-excel-library-tradeoffs.md) · [electron-gui-smoke-testing](research/2026-05-14-electron-gui-smoke-testing.md)

## Release notes

- [phase-0](release-notes/phase-0.md) · [phase-4-progress](release-notes/phase-4-progress.md) · [ui-redesign](release-notes/ui-redesign.md) · [undo-redo](release-notes/undo-redo.md)
