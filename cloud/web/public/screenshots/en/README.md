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

## How to regenerate as real English UI

The desktop app's e2e tour spec honors a `TOUR_LOCALE` env var (added
to `desktop/tests/e2e/_setup.ts` + `tour.spec.ts`). Run it with `en`
to capture English screenshots:

```bash
TOUR_LOCALE=en pnpm --filter carbonink test:e2e tests/e2e/tour.spec.ts
```

The harness pins `localStorage['carbonink.locale'] = 'en'` in two
places (Playwright `addInitScript` BEFORE the renderer bundle runs,
then a belt-and-braces `evaluate` + reload AFTER the first window
opens) so the renderer reliably mounts in English regardless of the
dev machine's OS locale. The `.en` suffix on output filenames keeps
zh and en runs side-by-side in the same directory.

Outputs land at `desktop/tests/e2e/screenshots/`:

| tour output                           | copy to                                                |
|---------------------------------------|--------------------------------------------------------|
| `tour-01-dashboard.en.png`            | `cloud/web/public/screenshots/en/dashboard.png`        |
| `tour-02-sources.en.png`              | `cloud/web/public/screenshots/en/sources.png`          |
| `tour-04-documents.en.png`            | `cloud/web/public/screenshots/en/documents.png`        |
| `tour-05-questionnaires.en.png`       | `cloud/web/public/screenshots/en/questionnaires.png`   |
| `tour-07-reports.en.png`              | `cloud/web/public/screenshots/en/reports.png`          |

(`tour-03-activities.en.png` and `tour-06-audit.en.png` aren't surfaced
on the marketing page — skip them.)

One-liner copy after the tour run:

```bash
TOUR_LOCALE=en pnpm --filter carbonink test:e2e tests/e2e/tour.spec.ts && \
  cp desktop/tests/e2e/screenshots/tour-01-dashboard.en.png      cloud/web/public/screenshots/en/dashboard.png && \
  cp desktop/tests/e2e/screenshots/tour-02-sources.en.png        cloud/web/public/screenshots/en/sources.png && \
  cp desktop/tests/e2e/screenshots/tour-04-documents.en.png      cloud/web/public/screenshots/en/documents.png && \
  cp desktop/tests/e2e/screenshots/tour-05-questionnaires.en.png cloud/web/public/screenshots/en/questionnaires.png && \
  cp desktop/tests/e2e/screenshots/tour-07-reports.en.png        cloud/web/public/screenshots/en/reports.png
```

Then commit + push; the cloud-deploy lane ships them automatically on
the next green main SHA.

## Re-running the zh tour (refresh the parent dir)

The default tour (no env var) captures zh-CN as before, writing the
unsuffixed `tour-NN-*.png` filenames. Those feed
`cloud/web/public/screenshots/*.png` (no `en/`).

```bash
pnpm --filter carbonink test:e2e tests/e2e/tour.spec.ts
# then cp tour-NN-*.png → cloud/web/public/screenshots/{name}.png
```

## Sanity checks after replacing

- Local: `pnpm --filter @carbonink-cloud/web dev` → open
  http://localhost:4321/en/ → hero + gallery should show English UI.
- Built: `pnpm --filter @carbonink-cloud/web build` → grep
  `dist/client/en/index.html` for `/screenshots/en/dashboard.png`.
