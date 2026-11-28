# carbonink-cloud — architecture notes

`cloud/` is a **single static marketing site** (CarbonInk is free &
open-source — no backend, no accounts, no payments). One package:

| Package | What | Status |
|---|---|---|
| `cloud/web/` | Astro marketing site (`/`, `/download`, `/privacy`, `/guides/*` + `/zh/` mirrors), prerendered to static HTML, served by the `carbonink-cloud-web` Worker via Static Assets | **Live** — the only thing that deploys |

Deploy steps: [DEPLOY.md](./DEPLOY.md).

## Topology

```
carbonink.xyz/*  →  carbonink-cloud-web   (cloud/web — static Astro, CDN HTML)
```

One Worker, one zone, all prerendered HTML. The desktop app is fully local
and never phones home.

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
- **Real 404s, agent-friendly bodies** — every nonexistent path returns a
  genuine HTTP 404 (never a 200 with page shell), so crawlers and agents can
  trust the status code. Two bodies for that one status: browsers get a
  branded noindex page (`src/pages/404.astro`); non-HTML clients (curl,
  agent harnesses — `Accept` without `text/html`, or `.md`/`.txt` paths) get
  a short markdown body pointing at `/llms.txt`, the sitemap, and guides
  (`src/middleware.ts`). Gotcha: keep `404.astro` **on-demand** (no
  `prerender`) — prerendering bakes it to static `404.html` at build time,
  where the build-time middleware pass (no browser Accept header) would bake
  the markdown variant in AND Static Assets would then answer misses without
  the worker, so runtime negotiation never runs.
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
- **Cloudflare Web Analytics** — the beacon is committed in `Base.astro`
  (PROD-gated; the token is a public site identifier, not a secret). The
  dashboard's **"automatic setup" for this zone must stay OFF** or every visit
  double-counts. Gotcha: auto-injection is **UA-conditional** (browsers get the
  beacon, curl doesn't) — so "curl shows no beacon" never proves analytics is
  off. Any change to what the site collects must update `/privacy/` + `/zh/privacy/`
  in the same commit.
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

## Brand palette — marketing site identity

The cloud site's color tokens (`cloud/web/src/styles/global.css`, documented
in `cloud/web/DESIGN.md`) pair CarbonInk's X2 stacked-rows mark with the
**ISO / Metrology Dossier** palette:

| Token | Value | Role |
|---|---|---|
| `--color-chamber` | `#133325` | Deep forest masthead, privacy interlude, footer, dark CTAs |
| `--color-background` | `#e8ece8` | Mineral engineering paper page ground |
| `--color-card` | `#f7f9f7` | Instrument-white panels, workbench deck, guide reading sheets |
| `--color-surface` | `#eff2ef` | Table headers, secondary rail, step bays |
| `--color-foreground` | `#111614` | Obsidian ink headings and body text on light ground |
| `--color-primary` | `#17724a` | Oxidized emerald actions, links, and focus rings (light) |
| `--color-emerald-bright` | `#6ce0a3` | Version chips, key labels, and focus rings inside `#133325` |
| `--color-ochre` | `#8c6223` | Scope 1 segment & domain category identifiers on light ground |
| `--color-border` / `-strong` | `#c5cdc8` / `#111614` | Hairline rules and `2px` architectural datum bars |
| `--color-moss-50..900` | `#eff4ef` .. `#0e261c` | Derived moss utility ramp preserved for Tailwind classes |

LogoMark + favicon keep the X2 "stacked data rows" mark verbatim
(`graphite #15171A` squircle + `cream #F4EFE3` top/bottom bars + `moss-500
#6B8266` middle bar).

**Do not introduce `bg-sky-*` / `text-sky-*` / `border-sky-*` here.** New chromatic accents go through the chamber / primary emerald / ochre / moss tokens documented above and in `cloud/web/DESIGN.md`.
