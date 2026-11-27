# English-UI screenshots

`cloud/web/src/components/Hero.astro` and `ScreenshotGallery.astro` read from
this directory when rendering `lang="en"` (the apex `/` route family). `Base.astro`
also uses `dashboard.png` from here for Open Graph / Twitter card previews when
sharing English pages.

This directory mirrors `../` (Simplified Chinese, used under `/zh/`) with the same
seven `1400×900` screenshots:

```text
dashboard.png  sources.png  documents.png  questionnaires.png
supplier-disclosures.png  activity-import.png  reports.png
```

## How to regenerate (CarbonInk 2.0)

Screenshots are captured from the real CarbonInk 2.0 native macOS desktop app
using `app/marketing_screenshots_test.go`, seeded with locale-native fixtures and
a local mock LLM server (no network calls required):

```bash
cd app && go tool nsgo test -target macos -env CARBONINK_CAPTURE_SCREENSHOTS=1 -screenshots .nsgo/marketing-shots -run TestCaptureMarketingScreenshots .
```

Because macOS Retina captures at `2800×1800`, resize to `1400×900` before
copying into place:

```bash
sips -z 900 1400 app/.nsgo/marketing-shots/*/*.png
cp app/.nsgo/marketing-shots/en/*.png cloud/web/public/screenshots/en/
cp app/.nsgo/marketing-shots/zh/*.png cloud/web/public/screenshots/
rm -rf app/.nsgo/marketing-shots
```

## Sanity checks after replacing

- Local: `pnpm --filter @carbonink-cloud/web dev` → inspect `http://localhost:4321/`
  (English) and `http://localhost:4321/zh/` (Simplified Chinese).
- Built: `pnpm cloud:build:web` → verify `dist/client/index.html` references
  `/screenshots/en/dashboard.png` and `dist/client/zh/index.html` references
  `/screenshots/dashboard.png`.
