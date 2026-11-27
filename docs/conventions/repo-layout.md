# Repo layout — monorepo

> Detailed reference for `AGENTS.md` → "Where things live". This file is linked,
> not auto-loaded; read it when you need the full monorepo picture.

CarbonInk 2.0 is a Go/NSGo native desktop app (`app/`) alongside an Astro
static marketing site (`cloud/web/`), sharing CI and docs in one repository:

```
carbonink/
├── package.json              ← workspace root, monorepo scripts
├── pnpm-workspace.yaml       ← lists cloud/web
├── AGENTS.md                 ← always-loaded conventions index
├── DESIGN.md / PRODUCT.md    ← CarbonInk 2.0 design system and product spec
├── docs/                     ← shared (conventions tracked; specs/plans local-only)
├── app/                      ← CarbonInk 2.0 native desktop app (NSGo / Go)
│   ├── go.mod                ← module app.carbonink.desktop
│   ├── nsgo.yaml             ← bundle id (app.carbonink.desktop), version, targets
│   ├── internal/             ← app UI, store, extraction, report, readiness, …
│   ├── locales/              ← en.yaml + zh-CN.yaml catalogs, generated catalog_gen.go
│   └── main.go               ← NSGo entry
└── cloud/                    ← Cloudflare static marketing site
    └── web/                  ← @carbonink-cloud/web (Astro → Static Assets)
```

> Note: The retired 1.x Electron codebase is archived on branch
> `archive/v1-electron` and tag `v1.2.0`.

**Top-level scripts** (run from repo root):

```bash
pnpm app:dev              # cd app && go tool nsgo dev .
pnpm app:check            # cd app && go tool nsgo check
pnpm app:test             # cd app && go test ./... && go tool nsgo test .
pnpm app:build            # cd app && go tool nsgo build -target macos_arm64
pnpm cloud:dev:web        # pnpm --filter @carbonink-cloud/web dev
pnpm cloud:preview:web    # pnpm --filter @carbonink-cloud/web preview
pnpm cloud:build:web      # pnpm --filter @carbonink-cloud/web build
```

**Why monorepo**: desktop + the marketing site share tooling, CI, version
metadata (`cloud/web` reads `app/nsgo.yaml` at build time), and docs in one
place — a single PR can touch both atomically.

**Brand identity**:
- Desktop UI palette and tokens live in `DESIGN.md` / `app/DESIGN.md` (emerald
  accent `#008c4f` light / `#00af67` dark).
- Marketing site palette and X2 mark live in `cloud/web/src/styles/global.css`,
  `cloud/web/src/components/LogoMark.astro`, and `cloud/web/public/favicon.svg`.
  Full cloud palette table + "don't reintroduce sky-blue" rule lives in
  `cloud/AGENTS.md` § "Brand palette".
