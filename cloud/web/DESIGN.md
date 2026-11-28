# CarbonInk Website Design System (`cloud/web`)

<!-- impeccable:design-schema 1 -->

The marketing site uses an **ISO / Metrology Dossier** visual system aligned with local-first carbon accounting: committed deep forest headers, mineral engineering paper ground, instrument-white reading panels, crisp datum rules, and self-hosted display/mono typography.

> The native desktop app (`app/`) maintains its own platform system in the repository root `DESIGN.md` and `app/DESIGN.md`.

## Colors

| Role | Token | Hex / Value | Usage |
|---|---|---|---|
| Chamber | `--color-chamber` | `#133325` | Deep forest masthead, privacy interlude, footer, dark download tiles |
| Chamber surface | `--color-chamber-surface` | `#0e261c` | Mobile nav drawer, recessed dark containers |
| Chamber ink | `--color-chamber-foreground` | `#f4f7f4` | Primary text on `#133325` |
| Chamber muted | `--color-chamber-muted` | `#b7cbc0` | Secondary body copy on `#133325` |
| Mineral paper | `--color-background` | `#e8ece8` | Primary page canvas across light sections |
| Instrument card | `--color-card` | `#f7f9f7` | Elevated tables, reading sheets, download panels, workbench deck |
| Surface inset | `--color-surface` | `#eff2ef` | Table headers, secondary action bays, workbench step rail |
| Obsidian ink | `--color-foreground` | `#111614` | Primary headings and body text on light ground |
| Muted graphite | `--color-muted-foreground` | `#46534c` | Supporting paragraphs and captions on light ground |
| Oxidized emerald | `--color-primary` | `#17724a` | Primary action links, focus rings, step emphasis on light ground |
| Bright emerald | `--color-emerald-bright` | `#6ce0a3` | Version chips, key highlights, and focus rings inside `#133325` |
| Technical ochre | `--color-ochre` | `#8c6223` | Scope 1 bar segment and mandate category codes on light surfaces |
| Bright ochre | `--color-ochre-bright` | `#e5b869` | Warm data highlights on dark forest surfaces |
| Hairline border | `--color-border` | `#c5cdc8` | Cell rules, accordion dividers, screenshot frames |
| Datum border | `--color-border-strong` | `#111614` | `2px` architectural datum bars and primary deck frames |
| Legacy moss ramp | `--color-moss-50..900` | `#eff4ef` .. `#0e261c` | Preserved for Tailwind `moss-*` utility compatibility |

## Typography

Self-hosted webfonts only under `cloud/web/public/fonts/` (OFL 1.1; CJK falls back cleanly to the platform stack):

- **Display & UI body (`--font-display`, `--font-body`)**: `"Schibsted Grotesk"` (`SchibstedGroteskVariable.woff2`, weights 400–900), tight display tracking `-0.03em`, desktop H1 `3.125rem` (`1.6875rem` on narrow mobile), section H2 `1.875rem`, body `1rem`.
- **Technical & tabular numerals (`--font-mono`)**: `"JetBrains Mono"` (`JetBrainsMono-{Regular,Medium}.woff2`), `font-variant-numeric: tabular-nums` for versions, file sizes, hashes, dates, Scope percentages, and CO₂e totals.

## Shapes, Rules & Elevation

- **Corner geometry**: Crisp `0px` (`rounded-none`) on `2px`-topped datum sheets and modal dialogs; minimal `2px` (`rounded-[2px]`) on buttons, inputs, tabs, and badges. Never apply a `2px` accent border onto rounded cards.
- **Hierarchy**: Built through full-bleed dark `#133325` ↔ mineral `#e8ece8` color planes, `2px` datum borders, and hairline matrix cells rather than blurred card clouds (`box-shadow` reserved solely for overlapping decks and modal lightboxes).
- **Accessible motion**: Respects `@media (prefers-reduced-motion: reduce)` and uses native HTML `<dialog>` + `<details>` for zero-dependency keyboard interaction.
