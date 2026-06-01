# CarbonInk → free & open-source (MIT) — implementation plan

> Spec: [docs/specs/2026-06-01-open-source-free-pivot.md](../specs/2026-06-01-open-source-free-pivot.md).
> Phased so each task is independently committable + verifiable. Per-task gate:
> `pnpm --filter carbonink typecheck && pnpm --filter carbonink test` (+ scoped
> `biome`) for desktop; `astro build` for web. Current desktop baseline before
> this work: **935** (it will drop as license tests are removed — record the new
> number in AGENTS.md at the end).

---

## Task 0 — Pre-flight verification (read-only, no commit)

Confirm the three spec assumptions before deleting anything:
- [ ] `/download/mac|win` resolve via the **GitHub release**, not the worker's R2
  `RELEASES` bucket. (grep `cloud/web/src/pages/download*` + the `/download/*`
  endpoints.)
- [ ] No consumer other than desktop + the soon-deleted account/admin web pages
  calls `/api/*` (grep `cloud/web` + `desktop` for `/api/`, `API_BASE`, `carbonink.xyz/api`).
- [ ] No real field licenses to worry about (pre-launch). If any, note the
  migration risk in the release notes.

Output: a short note in the plan (or a comment on the PR) confirming each. If any
fails, pause and revise the spec.

---

## Task 1 — Desktop: drop the license gate (the app becomes free)

**Files:** `src/main/ipc/setup.ts` / `context.ts` (wherever the gate is applied),
`src/main/ipc/license-gate.ts` (+ its test), `__root.tsx` (LicenseBanner).

- [ ] Remove the license-gate call from the IPC dispatch pipeline; delete
  `license-gate.ts` + `license-gate.test.ts`.
- [ ] Remove `<LicenseBanner/>` from `__root.tsx`.
- [ ] Gate: `typecheck` + `test` (gate test gone; the pipeline test may need the
  gate-mock removed) + `biome`.
- [ ] Commit: `feat(oss): remove license write-gate — every action is free`.

## Task 2 — Desktop: delete the license services, IPC, UI, migration, i18n

**Delete:** `license-service.ts`, `license-state-machine.ts`,
`license-public-key.ts`, `ipc/handlers/license.ts`, `renderer/lib/api/license.ts`,
`LicenseSection.tsx`, `LicenseBanner.tsx`, `LicenseChip.tsx`, their tests, and
`db/migrations/016_license_local_state.sql`.

- [ ] Unwire: License section out of `SettingsPage.tsx`; `<LicenseChip/>` out of
  the header; license service out of `ipc/context.ts`; license handlers out of
  `ipc/setup.ts`.
- [ ] Drop `license:*` from `ipc/types.ts` + preload `allowedChannels`; update the
  parse-driven allowlist test (`tests/preload/bridge.test.ts`).
- [ ] Remove `license_*` / activation keys from `messages/en.json` + `zh-CN.json`
  (keep aligned); recompile paraglide; fix any renderer refs.
- [ ] Remove `API_BASE` + activation fetch + any license `Env` fields.
- [ ] Reset the dev DB (so the dropped 016 isn't applied): `node scripts/reset-dev-db.mjs`.
- [ ] Gate: `typecheck` + `test` + `biome`. Record the new test count.
- [ ] Commit: `feat(oss): delete the licensing/activation system from the desktop app`.

## Task 3 — Website: delete pricing / activation / account / admin

**Delete pages:** `pricing.astro` (+ `zh/`), `activate.astro` (+ `zh/`),
`account/**` (+ `en/`/`zh/` mirrors, incl. `login` + `login/callback`),
`admin/**`. **Delete components:** `PricingPlans`, `PricingTeaser`, `PricingFaq`,
`LicenseKeyCard`. **Delete** the account/admin `middleware.ts` gating.

- [ ] Remove the deleted routes from `astro.config` sitemap + any prerender lists.
- [ ] Gate: `pnpm --filter @carbonink-cloud/web build` succeeds.
- [ ] Commit: `feat(oss): remove pricing/activation/account pages from the site`.

## Task 4 — Website: reframe copy as free & open-source

- [ ] Hero: replace the "See pricing" CTA with a GitHub/source link (keep the free
  Download CTA).
- [ ] Nav + Footer: drop the Pricing link; add a Source / GitHub link.
- [ ] `index.astro` + `zh/index.astro`: remove `<PricingTeaser/>`.
- [ ] `privacy.astro`: remove Stripe / billing / license-key copy → local-only +
  open-source framing.
- [ ] `DownloadButtons`: "free trial" → "free & open source".
- [ ] Add a small "open source · MIT" line + repo link (hero or footer).
- [ ] Grep the site for residual pricing/charging copy (价格/收费/付费/trial/
  subscribe/$/￥) and clear it.
- [ ] Gate: `astro build` + a manual link check (no link points at a deleted page).
- [ ] Commit: `feat(oss): reframe the site as free & open-source; drop pricing copy`.

## Task 5 — Cloud worker: decommission

- [ ] Remove the worker's `/api/*` route registration (single-domain routing) so
  the path stops resolving; remove it from any deploy script / CI.
- [ ] Add a `DEPRECATED` note to `cloud/worker/README.md` (retired with the OSS
  pivot; code kept for history; manual dashboard teardown is a follow-up).
- [ ] Leave the code in-repo; don't delete the package (history).
- [ ] Gate: repo still builds; `cloud:test` for any remaining non-license tests.
- [ ] Commit: `chore(oss): decommission the license/payments API worker`.

## Task 6 — Repo: MIT license + docs

- [ ] Add `LICENSE` (MIT) at the repo root (current year + author).
- [ ] README (repo + `desktop/`): free, open-source, MIT, build-from-source steps.
- [ ] `docs/ROADMAP.md`: a "Open-source + free pivot (2026-06-01)" section.
- [ ] `AGENTS.md`: drop the now-false "license-gate" context; update the test
  baseline number; note licensing was removed.
- [ ] `docs/README.md`: index this spec + plan.
- [ ] Commit: `docs(oss): MIT license + open-source README + roadmap`.

## Task 7 — Full verification

- [ ] `pnpm --filter carbonink typecheck && pnpm --filter carbonink test` green at
  the new baseline; scoped `biome` clean on all changed files.
- [ ] `pnpm --filter @carbonink-cloud/web build` green; site has no pricing/
  activation/account routes and no dead links.
- [ ] (Optional) run the Playwright tour to re-snapshot the site if it's wired.
- [ ] Commit any baseline-doc fixups.

---

## Manual follow-ups (out of code scope — your action)

- Cloudflare: delete/disable the `cloud/worker` Worker; remove its route; drop the
  D1 DB + KV namespaces; rotate/remove the Stripe + license-signing secrets.
- Stripe: deactivate products/prices; close the account if unused.
- GitHub: make the repo public; add `CONTRIBUTING.md`, issue templates, OSS CI.
- DNS: `carbonink.xyz/api/*` can be dropped once the Worker is gone.
