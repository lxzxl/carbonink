# English-UI screenshots

`cloud/web/src/components/Hero.astro` + `ScreenshotGallery.astro` pick
from this directory when rendering at `lang="en"` (the `/en/*` route
family). `Base.astro` also pulls `dashboard.png` from here for the
OG/Twitter card preview when sharing `/en/` links.

Mirrors the directory above (`../`) exactly — same five filenames:

```
dashboard.png  documents.png  questionnaires.png  reports.png  sources.png
```

## Why these files initially look identical to the zh ones

This directory was scaffolded with **copies of the zh screenshots** as
placeholders, so the EN marketing page never 404s. They look "Chinese"
because they are — the desktop app's e2e tour ran in zh locale when it
produced the parent-dir set.

The wiring is in place. Once real English-UI screenshots replace these
files, the EN marketing page automatically picks them up — no code
change needed.

## How to regenerate as real English UI

The desktop app's startup locale (`desktop/src/renderer/lib/i18n.ts`)
is decided in this order:

1. `localStorage['carbonink.locale']` — sticky user preference
2. `window.navigator.language` — Chromium's reported lang
3. fallback to `'en'`

The e2e `tour.spec.ts` runs Playwright Chromium with the OS's default
locale. On a zh-locale macOS that means `navigator.language === 'zh-CN'`
→ app loads zh.

The cleanest way to flip the tour to English: launch Playwright's
Chromium context with `locale: 'en-US'`. Two options:

### Option A — one-off run, no spec changes

```bash
# Launch the e2e tour with Chromium forced to en-US.
# Requires temporarily editing tour.spec.ts to pass `locale: 'en-US'`
# into the launch options, OR setting the env at the OS level.
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
  pnpm --filter carbonink test:e2e tests/e2e/tour.spec.ts
```

If the OS-level LANG override doesn't propagate (depends on Playwright
version), use Option B.

### Option B — locale-aware tour spec (cleanest, but a small code change)

Edit `desktop/tests/e2e/tour.spec.ts` to honor a `TOUR_LOCALE` env var,
then plumb it into `_setup.ts → launchApp` so the Electron / Chromium
context starts with that locale. Run twice:

```bash
TOUR_LOCALE=zh-CN pnpm --filter carbonink test:e2e tests/e2e/tour.spec.ts
TOUR_LOCALE=en    pnpm --filter carbonink test:e2e tests/e2e/tour.spec.ts
```

The tour writes seven screenshots to
`desktop/tests/e2e/screenshots/tour-*.png`. The five used here:

| tour output                          | copy to                                    |
|--------------------------------------|--------------------------------------------|
| `tour-01-dashboard.png`              | `cloud/web/public/screenshots/en/dashboard.png`     |
| `tour-02-sources.png`                | `cloud/web/public/screenshots/en/sources.png`       |
| `tour-04-documents.png`              | `cloud/web/public/screenshots/en/documents.png`     |
| `tour-05-questionnaires.png`         | `cloud/web/public/screenshots/en/questionnaires.png` |
| `tour-07-reports.png`                | `cloud/web/public/screenshots/en/reports.png`       |

(`tour-03-activities.png` and `tour-06-audit.png` aren't surfaced on
the marketing page — skip them.)

Commit the replaced PNGs; the cloud-deploy CI lane ships them
automatically on push to main.

## Sanity checks after replacing

- Local: `pnpm --filter @carbonink-cloud/web dev` → open
  http://localhost:4321/en/ → hero + gallery should show English UI.
- Built: `pnpm --filter @carbonink-cloud/web build` → grep
  `dist/client/en/index.html` for `/screenshots/en/dashboard.png`.
