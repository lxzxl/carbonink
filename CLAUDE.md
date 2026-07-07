@AGENTS.md

## Design Context

Frontend design work has a captured strategic + visual system at the repo root:

- [`PRODUCT.md`](PRODUCT.md) — register (`product`), users (ESG consultants
  primary), audit-grade-confidence purpose, brand personality (calm · precise ·
  native), anti-references, and 5 design principles.
- [`DESIGN.md`](DESIGN.md) — the visual system. North Star **"The Ledger"**:
  pure-white surfaces, ink foreground, one carbonink-green accent (≤10% per
  screen), flat-by-border elevation, native chrome. Tokens are canonical in
  OKLCH and mirror `desktop/src/renderer/styles/globals.css`.

Read both before any UI change. They're consumed by the `/impeccable` skill;
`.impeccable/design.json` is its machine-readable sidecar (do not hand-edit).
