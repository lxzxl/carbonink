# carbonink — Design Preferences

Local conventions any agent working in this repo should follow. Skills and
plans build on top of these; when a skill conflicts with this file, this
file wins (per the user's explicit instructions).

## Repo layout — monorepo

This is a pnpm workspace. Two top-level apps share tooling + docs:

```
carbonink/
├── package.json              ← workspace root, monorepo scripts
├── pnpm-workspace.yaml       ← lists desktop + cloud/* packages
├── docs/                     ← shared (specs, plans, release notes)
├── CLAUDE.md                 ← this file
├── desktop/                  ← Electron app (the user-facing v1)
│   ├── package.json          ← name: "carbonink"
│   ├── src/                  ← main, preload, renderer, shared
│   ├── tests/                ← vitest (target: 662 passing)
│   └── …                     ← electron-vite, electron-builder, paraglide
└── cloud/                    ← Cloudflare backend (license + payments)
    ├── worker/               ← @carbonink-cloud/worker (API)
    ├── packages/shared/      ← @carbonink-cloud/shared (Zod + types)
    └── sites/                ← @carbonink-cloud/{marketing,activate,account}
                                 (each is its own Worker with Static
                                  Assets binding — Cloudflare's modern
                                  replacement for Pages)
```

**Top-level scripts** (run from repo root):

```bash
pnpm desktop:test         # 662 vitest tests in desktop/
pnpm desktop:typecheck    # tsc --noEmit on desktop/
pnpm cloud:test           # 72 worker tests under cloud/worker/
pnpm test                 # all packages (workspace-concurrency=1)
```

**Per-package scripts** still work via filter:

```bash
pnpm --filter carbonink dev          # electron-vite dev (desktop)
pnpm --filter @carbonink-cloud/worker test
pnpm --filter @carbonink-cloud/marketing build
```

**Why monorepo**: desktop's `Env`/`LicenseJwtClaims` types and cloud's
`@carbonink-cloud/shared` JWT claims schema must stay in lockstep —
they describe the same protocol. Having both in one repo + workspace
means a single PR can update both sides atomically, and a future
`packages/shared-protocol` could replace the parallel definitions.

**`onlyBuiltDependencies`** lives in the top-level `package.json` (pnpm
warns if it's at a sub-package). Includes `better-sqlite3`, `electron`,
`esbuild`, `sharp`, `workerd`, `@napi-rs/canvas-*`. New native deps
must be added here before pnpm will run their postinstall.

## Cloud deploy primitives — Workers everywhere

Every cloud package is a Cloudflare Worker (the API + each of the 3
sites). We do NOT use Cloudflare Pages — Cloudflare's recommended
path now is Workers + the Static Assets binding, which subsumes Pages'
capabilities and gets all the new platform features first.

Per cloud package:

- **`cloud/worker/`** — pure Worker (API endpoints + scheduled cron).
  Deploy: `cd cloud/worker && wrangler deploy`.
- **`cloud/sites/marketing/`** — static-only Astro site. No SSR
  adapter. wrangler.toml has just `assets.directory = "./dist"` +
  `not_found_handling = "single-page-application"`. Deploy:
  `pnpm --filter @carbonink-cloud/marketing deploy` →
  `astro build && wrangler deploy`.
- **`cloud/sites/activate/`** + **`cloud/sites/account/`** — SSR
  Astro sites via `@astrojs/cloudflare` v13. Build emits
  `dist/client/` (static) + `dist/server/entry.mjs` (Worker entry) +
  `dist/server/wrangler.json` (adapter-generated final config). The
  user-level `wrangler.toml` carries name/compat-flags/[vars]; the
  adapter augments at build time. Deploy: `astro build && wrangler
  deploy --config dist/server/wrangler.json`.

**Gotcha**: don't put `main` in a user-level `wrangler.toml` for SSR
sites. The `@cloudflare/vite-plugin` bundled into `@astrojs/cloudflare`
v13 resolves `main` at vite-config time, before astro emits the
build output → ENOENT. The adapter sets `main` itself in
`dist/server/wrangler.json`.

### Single-domain routing

Everything serves under `carbonink.xyz`. Each Worker declares its
prefix in `wrangler.toml`:

| Worker | Path prefix | Notes |
|--------|------------|-------|
| API (`cloud/worker`) | `/api/*` | Entry strips `/api` so handlers match `/v1/*` |
| activate (`cloud/sites/activate`) | `/activate`, `/activate/*` | Astro `base: '/activate'` |
| account (`cloud/sites/account`) | `/account`, `/account/*` | Astro `base: '/account'` |
| marketing (`cloud/sites/marketing`) | `/*` (catch-all) | Least-specific; everything else lands here |

Cloudflare's edge dispatches by longest-prefix match, so the
catch-all only sees paths the other three didn't claim.

Same-origin benefits this buys:

- **Cookie**: `session` has no `Domain` attribute (same-origin
  auto-sent). Set in `auth.ts`, cleared in `account-delete.ts`.
- **CORS**: not needed for web. API uses permissive
  `Access-Control-Allow-Origin: *` with no `Allow-Credentials`. Web
  clients are same-origin (CORS doesn't fire); the desktop Electron
  client uses the license JWT in the body (no cookies).
- **Client fetch**: relative URLs (`/api/v1/...`) from `<script>` in
  Astro pages. Astro SSR fetches build an absolute URL via
  `new URL('/api/v1/...', new URL(Astro.request.url).origin)` because
  Worker `fetch()` needs an absolute URL even for same-origin calls.

Previously each site had its own subdomain (`api.`, `activate.`,
`account.`); that's retired — added DNS + CORS + cookie `Domain=`
complexity for no real benefit since they're all parts of one
product. Don't reintroduce subdomains without a strong reason.

**Astro `base` gotcha**: with `base: '/account'`, internal `<Link>`
components get rewritten, but raw `<a href="/login">` does NOT. Audit
any hardcoded `href`/`action` paths in SSR sites and prefix them
manually (e.g. `/account/login`).

## Scroll containment

**Default**: page chrome stays put; only the content the user is reading scrolls.

For any list-or-detail page where the action surface is reusable (heading,
filter bar, action buttons), do NOT let those scroll off-screen. Pin them
top and/or bottom and confine the scroll to the data region in the middle.

### When the page is just a list (e.g. `/sources`, `/activities`)

```tsx
<Main className="flex h-full flex-col gap-4">
  <div className="shrink-0">{/* heading + Add button + open form */}</div>
  <ul className="flex-1 min-h-0 overflow-auto …">{/* items */}</ul>
</Main>
```

- `Main` becomes a flex column at full parent height. Its built-in
  `px-6 py-6` padding still applies — `box-sizing: border-box` is in
  effect so `h-full` already accounts for it.
- The top section is `shrink-0` so it never collapses.
- The list claims `flex-1 min-h-0` (the `min-h-0` is mandatory — flex
  children default to `min-height: auto` and won't shrink past
  intrinsic content size without it) and owns its own `overflow-auto`.
- The root scroll container (`<div @container/content overflow-auto>`
  in `__root.tsx`) never triggers because the inner content fits the
  parent's height exactly.

### When the page has top + bottom chrome (e.g. `/questionnaires/$id`)

```tsx
<div className="flex h-full flex-col">
  <div className="shrink-0 px-6 pt-6 pb-3">{/* heading + meta + warnings */}</div>
  <div className="flex-1 min-h-0 overflow-auto px-6">{/* scrolling cards */}</div>
  <div className="shrink-0 flex justify-end gap-2 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
    {/* action bar — Finalize / Export / Generate */}
  </div>
</div>
```

- The action bar has a subtle top border + translucent backdrop so it
  reads as a distinct surface from the scrolling content above it.
- The action bar is hidden when the list is empty (no actions are
  meaningful then).
- Padding lives on each section (not the outer wrapper) so the border
  on the bottom bar runs edge-to-edge.

### When the page renders inside a two-pane Outlet (e.g. `/questionnaires/*`)

The parent layout's right pane is **`overflow-hidden`, no padding**:

```tsx
<ResizablePanel defaultSize="68%">
  <div className="h-full overflow-hidden">
    <Outlet />
  </div>
</ResizablePanel>
```

Each Outlet child owns its own padding + scroll structure. A child that
DOES want a single body scroll (e.g. `/questionnaires/new` upload form)
wraps `<Main>` in `<div className="h-full overflow-auto">`. A child that
wants sticky-top/bottom uses the flex-column pattern above.

**Don't** put `overflow-auto p-6` on the right-pane wrapper itself — it
forces every child through one rigid scroll model and breaks the
sticky-bottom action-bar pattern. Centralized padding also makes
children's `h-full` overshoot by the padding amount and trigger an
unintended outer scrollbar.

## List item layout (preferred over HTML tables for data pages)

Reach for a vertical card-row list before reaching for a `<table>`.
Tables force every cell into a single line and a fixed column width,
which causes horizontal-overflow and truncation as soon as one EF
descriptor or one source name grows. A list-item layout:

```
┌──────────────────────────────────────────────┐
│ Source name (truncates)         ● status     │
│ [SCOPE] · category · other meta              │
└──────────────────────────────────────────────┘
```

- Title row: primary identifier (name / question), `truncate` + `title=`
  attribute for hover tooltip.
- Meta row: chip(s) + dot-separated secondary metadata.
- Right side: status indicator OR a single trailing action (Rebind,
  Open). For more than one action, drop into a dropdown.
- Container: `<ul className="divide-y divide-border rounded-md border border-border bg-card">` and `<li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">`.
- Numbers use `tabular-nums`; codes use `font-mono`.

Reserve `<table>` for pages where a column-aligned dataset really is the
deliverable (e.g. an exported activity ledger). For interactive Inventory
+ Inputs pages where users scan one item at a time, use the list form.

## Action button hierarchy (skill 06 — native conventions)

Reserve `variant="default"` (filled green) for the ONE most important
action on a page. Everything else uses `variant="outline"` or
`variant="ghost"`. The questionnaire detail action bar is the
canonical pattern: Finalize is filled; Generate-all, Export-Excel,
Export-PDF are outline.

## i18n

All user-facing strings go through paraglide messages (`messages/en.json`
+ `messages/zh-CN.json`). Both files must have the exact same key set —
the Phase 5 sweep includes a key-alignment check. New features add keys
to BOTH files in the same commit.

## Test discipline

- vitest baseline: 662/662 passing on `main` after `v1.0.0`. Don't land
  a commit that drops below this.
- The pre-existing biome lint debt (~940 errors) is documented as
  deferred to v1.0.1. Don't fix it incidentally. New code MUST lint
  clean on a scoped `biome check <changed-files>` though.
- After `pnpm build` (or any script that runs `electron-rebuild`),
  vitest will fail with `NODE_MODULE_VERSION 145 vs 137` because
  better-sqlite3's native binding flipped to Electron ABI. Restore
  with:
  ```bash
  rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  pnpm rebuild better-sqlite3
  ```
  This is environmental, never a regression.
