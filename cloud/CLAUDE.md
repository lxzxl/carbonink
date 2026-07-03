# carbonink-cloud — architecture notes

`cloud/` is now a **single static marketing site**. CarbonInk went free &
open-source (MIT), which removed activation, licensing, and payments — so the
backend that powered them is **retired**.

| Package | What | Status |
|---|---|---|
| `cloud/web/` | Astro marketing site (`/`, `/download`, `/privacy` + `/zh/` mirrors), prerendered to static HTML, served by the `carbonink-cloud-web` Worker via Static Assets | **Live** — the only thing that deploys |
| `cloud/worker/` | old `carbonink-cloud-api`: Stripe checkout, Ed25519 license signing, magic-link accounts, admin queue | **Retired** — not deployed, `/api/*` route commented out; code + tests kept for history ([README](worker/README.md)) |

Deploy steps: [DEPLOY.md](./DEPLOY.md).

## Topology

```
carbonink.xyz/*  →  carbonink-cloud-web   (cloud/web — static Astro, CDN HTML)
```

One Worker, one zone, all prerendered HTML. **There is no `/api/*` route
anymore** — the desktop app is fully local and never phones home.

> **History.** Before the OSS pivot this was two Workers wired by a service
> binding: the web worker SSR'd `/activate` + `/account/*` and called the api
> worker over `env.API` for license lookups, Stripe checkout resolution, and
> magic-link session exchange. All retired. The one lesson worth keeping:
> **never `fetch()` your own zone's public URL from inside a Worker** —
> Cloudflare loops it at the routing layer for ~20s before giving up. If you
> ever re-add a web→api hop, use a service binding, not a public self-fetch.
> Full detail is in git history + `cloud/worker/README.md`.

## SEO — making carbonink.xyz findable

English is the default locale at the apex (`/`, `/download/`, `/privacy/`);
Chinese lives under `/zh/` (flipped 2026-06; was zh-at-apex before). The
marketing pages are the indexable surface.

- **Sitemap** — `@astrojs/sitemap` emits `sitemap-index.xml` + `sitemap-0.xml`
  (all prerendered pages: `/`, `/download`, `/privacy`, `/guides/` + per-guide
  pages at the en apex + their `/zh/` mirrors), each with
  `<xhtml:link rel="alternate" hreflang="…">` cross-refs. Gotcha: the
  integration's `i18n` option can't pair an unprefixed default locale with
  `/zh/*`, so the alternates are injected by hand in `serialize`
  (astro.config.mjs). New marketing pages get indexed automatically.
- **Guides content layer** — `src/content/guides/{en,zh}/<slug>.mdx`
  (content collection, `src/content.config.ts`), rendered by
  `GuideLayout.astro` (TOC, breadcrumbs + BreadcrumbList/TechArticle JSON-LD,
  related links, download CTA). **Guides must ship as en+zh pairs with the
  same slug** — Base.astro derives hreflang mechanically, so a missing mirror
  advertises a 404 to Google.
- **robots.txt / llms.txt** — `public/robots.txt` references the sitemap and
  explicitly allows AI crawlers (GPTBot/ClaudeBot/PerplexityBot);
  `public/llms.txt` is the AI-engine product summary.
- **Fonts are self-hosted** (`public/fonts/`, OFL) — do NOT reintroduce the
  Google Fonts CDN; it's blocked in mainland China. CJK intentionally uses the
  system stack (PingFang SC / Microsoft YaHei), no CJK webfont.
- **Per page** (`cloud/web/src/layouts/Base.astro`): `<link rel="canonical">`,
  `hreflang` (zh-CN / en / x-default→en), full Open Graph + Twitter Card with a
  locale-aware OG screenshot, and three JSON-LD blocks (SoftwareApplication /
  Organization / WebSite). The SoftwareApplication `Offer` is **price `0` USD**
  — free & open-source.
- **Bot-aware locale redirect** — the inline locale-detect script in
  `Base.astro` short-circuits for crawler UAs (`/bot|crawl|spider|…/i`) so
  Google can independently crawl the apex (en) and `/zh/` homepages; the
  hreflang tags tell it they're mirrors.
- **One-time** — submit `https://carbonink.xyz/sitemap-index.xml` to Google
  Search Console (Domain property covers www + subdomains) and Bing Webmaster.
  A brand-new domain takes ~1–7 days to index; faster once it accrues backlinks
  (HN / GitHub README / newsletters).

## Brand palette — same identity as the desktop app

The cloud site's color tokens (`cloud/web/src/styles/global.css`) are aligned
with the desktop X2 icon design. **Source of truth** is
`desktop/scripts/icon-designs.mjs::PALETTE` — when the desktop identity moves,
this file moves with it.

| Token | Hex | Role |
|---|---|---|
| `--color-primary` / `moss-500` | `#6B8266` | CTA buttons, focus rings, badges, accent text |
| `--color-primary-foreground` | `#ffffff` | Text on `bg-primary` (4.9:1 contrast on moss-500, WCAG AA-pass) |
| moss ramp `50/100/200/300/600/700/800/900` | derived | Soft backgrounds, borders, hover states |
| `--color-background` | `#ffffff` | Page background |
| `--color-foreground` | `#0f172a` | Body text |
| `--color-border` | `#e2e8f0` | Neutral chrome borders |

LogoMark + favicon use the X2 "stacked data rows" mark verbatim
(`graphite #15171A` squircle + `cream #F4EFE3` top/bottom bars + `moss-500
#6B8266` middle bar). SVG coords are in 1024-design-space so they copy-paste
directly from `drawDirectionX2`.

**Do not introduce `bg-sky-*` / `text-sky-*` / `border-sky-*` here.** The old
Figma Make palette is fully retired. New chromatic accents go through the moss
ramp; if a shade is missing, extend the ramp in `global.css` rather than
reaching for a different Tailwind family. The `--color-brand-*` legacy aliases
also point at moss; they're a soft-landing pad for stale references, not a
second palette.

Reminder: this brand is "old money green" — pharmacist's apothecary jar,
antique library, Jaguar dashboard — NOT a recycling-symbol / SaaS-eco green.
Resist the urge to bump saturation when adding shades.

## Test conventions

`cloud/worker/tests/*.test.ts` still run in CI (`pnpm cloud:test`) even though
the Worker is retired — keeping them green stops the frozen backend from
bit-rotting until someone deletes it outright. They use
`@cloudflare/vitest-pool-workers`:

- **Migrations apply once per run** (`apply-migrations.ts`, `beforeAll`); D1/KV
  bindings are *shared* across tests in a file — use distinct emails / IPs / IDs
  rather than wiping state.
- **Stub the EMAIL binding** with `vi.fn()`: `(env as any).EMAIL = { send: spy }`.
- **Build session JWTs directly** with the test key (`signSessionJwt`); set as
  `Cookie: session=<jwt>`. See `tests/admin.test.ts` for the full pattern.
