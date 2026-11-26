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
because they are — initial placeholder content, NOT real English UI.

The wiring is in place. Once real English-UI screenshots replace these
files, the EN marketing page automatically picks them up — no code
change needed.

## How to regenerate

The screenshots currently in this directory were captured from the 1.x
Electron e2e tour (`archive/v1-electron` branch, `tour.spec.ts` with
`TOUR_LOCALE=en`). Keep the five filenames below in sync when refreshing
screenshots from CarbonInk 2.0 (`app/`):

```
dashboard.png  sources.png  documents.png  questionnaires.png  reports.png
```

## Sanity checks after replacing

- Local: `pnpm --filter @carbonink-cloud/web dev` → open
  http://localhost:4321/en/ → hero + gallery should show English UI.
- Built: `pnpm --filter @carbonink-cloud/web build` → grep
  `dist/client/en/index.html` for `/screenshots/en/dashboard.png`.
