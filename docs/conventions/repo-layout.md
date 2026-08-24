# Repo layout — monorepo

> Detailed reference for `AGENTS.md` → "Where things live". This file is linked,
> not auto-loaded; read it when you need the full monorepo picture.

This is a pnpm workspace. Two top-level apps share tooling + docs:

```
carbonink/
├── package.json              ← workspace root, monorepo scripts
├── pnpm-workspace.yaml       ← lists desktop + cloud/web packages
├── docs/                     ← shared (specs, plans, release notes, conventions)
├── CLAUDE.md                 ← @AGENTS.md (the always-loaded conventions index)
├── desktop/                  ← Electron app (the user-facing v1)
│   ├── package.json          ← name: "carbonink"
│   ├── src/                  ← main, preload, renderer, shared
│   ├── tests/                ← vitest (932 passing as of 2026-05-29)
│   └── …                     ← electron-vite, electron-builder, paraglide
└── cloud/                    ← Cloudflare static marketing site
    └── web/                  ← @carbonink-cloud/web (Astro → Static Assets)
```

**Top-level scripts** (run from repo root):

```bash
pnpm desktop:test         # vitest tests in desktop/
pnpm desktop:typecheck    # tsc --noEmit on desktop/
pnpm test                 # all packages (workspace-concurrency=1)
```

**Per-package scripts** still work via filter:

```bash
pnpm --filter carbonink dev          # electron-vite dev --watch (renderer HMR + main/preload hot-restart)
pnpm --filter @carbonink-cloud/web build
```

**Why monorepo**: desktop + the marketing site share tooling, CI, and docs in
one place — a single PR can touch both apps atomically.

**`onlyBuiltDependencies`** lives in the top-level `package.json` (pnpm
warns if it's at a sub-package). Includes `better-sqlite3`, `electron`,
`esbuild`, `sharp`, `workerd`, `@napi-rs/canvas-*`. New native deps
must be added here before pnpm will run their postinstall.

**Brand identity is unified** across desktop + cloud — `--color-primary`
in `cloud/web/src/styles/global.css` is bound to the X2 mark's moss-green
accent (`#6B8266`), and the LogoMark/favicon are verbatim ports of the
desktop icon. Source of truth is `desktop/scripts/icon-designs.mjs`.
Full palette table + "don't reintroduce sky-blue" rule lives in
`cloud/CLAUDE.md` § "Brand palette".

**Electron pinned at `^41.5.1`** — not the latest. We can't move to v42
yet because `better-sqlite3` (latest 12.10.0) doesn't compile against
Electron 42's V8 14.8 API. The upstream fix
([better-sqlite3 PR #1475](https://github.com/WiseLibs/better-sqlite3/pull/1475))
is maintainer-approved but unmerged. Full investigation + re-attempt
checklist in `docs/research/2026-05-25-electron-42-upgrade-blocker.md`.
