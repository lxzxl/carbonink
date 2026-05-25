/**
 * Icon design variants — pure canvas drawing functions.
 *
 * Each `draw*` function takes a 2D canvas context and a target pixel
 * size, then renders the icon at that resolution. All coordinates are
 * authored in a 1024-unit design space and scaled by `size / 1024`,
 * so a single source produces pixel-clean output at 16, 32, 256, 1024,
 * etc.
 *
 * Design vocabulary — international minimal:
 *   - Bold flat background (no gradient, no texture)
 *   - Single geometric mark inside (letterform or abstract data motif)
 *   - At most one accent color (muted green — never SaaS-eco green)
 *   - No drop shadows, no inner glows, no 3D effects
 *
 * Reference vocabulary: Linear, Vercel, Cron, Things 3, Arc browser,
 * Stripe. Quiet confidence at the level of a tier-one international
 * developer tool — not a Chinese SaaS, not an "eco" app.
 *
 * Palette:
 *   forest-green   #1F3A2E   deep luxury green, "old money" not "eco app"
 *   graphite       #15171A   warm near-black for backgrounds (alt to green)
 *   moss-accent    #6B8266   the only "visible" green — used as accent
 *   cream          #F4EFE3   warm off-white for marks on dark backgrounds
 *   parchment      #F5F1E8   alt background (light variant)
 */

export const PALETTE = {
  forestGreen: '#1F3A2E',
  graphite: '#15171A',
  mossAccent: '#6B8266',
  cream: '#F4EFE3',
  parchment: '#F5F1E8',
};

/** macOS Big Sur app-icon corner radius — 22% of canvas (close to squircle). */
const CORNER_RATIO = 0.22;

/** Older @napi-rs/canvas releases didn't ship ctx.roundRect — fallback path. */
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─────────────────────── Direction X1 — Bold "C" ───────────────────────

/**
 * A single bold geometric C on a deep forest-green background.
 * Monogram vocabulary — same family as Linear, Cron, Notion: rounded
 * square + single white letterform + nothing else.
 *
 * The C is drawn as a thick arc with rounded line caps so it reads as
 * a typographic letter, not a pizza slice. Spans ~67% of canvas width
 * — large enough to be unmistakable at 16×16, small enough to leave
 * comfortable padding inside the squircle.
 *
 * No accent, no extra elements. The product takes its character from
 * the green itself: this is the green of a Jaguar dashboard, an
 * antique library, a pharmacist's apothecary jar — not a recycling
 * symbol.
 */
export function drawDirectionX1(ctx, size) {
  const s = size / 1024;

  ctx.fillStyle = PALETTE.forestGreen;
  roundedRectPath(ctx, 0, 0, size, size, CORNER_RATIO * size);
  ctx.fill();

  // The C — thick rounded arc, anticlockwise from upper-right to
  // lower-right (going through 12/9/6 o'clock, so the opening sits
  // on the right side).
  ctx.strokeStyle = PALETTE.cream;
  ctx.lineWidth = 130 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(
    512 * s,
    512 * s,
    265 * s,
    -Math.PI * 0.28, // start ~upper-right
    Math.PI * 0.28, //  end   ~lower-right
    true, //          anticlockwise
  );
  ctx.stroke();
}

// ────────────────── Direction X2 — Stacked Data Rows ──────────────────

/**
 * Three horizontal bars stacked vertically on a warm-graphite
 * background. Reads as "rows of data" — the abstraction of a ledger
 * or spreadsheet. Bars vary slightly in length, like real data values.
 *
 * The middle row is rendered in moss green — that's the "carbon
 * entry," the row in your ledger that matters here. The two flanking
 * rows in cream give the bar enough visual ground that the green row
 * doesn't have to scream.
 *
 * Vocabulary cousins: the Cron icon, certain Arc/Raycast variants,
 * the Things 3 checkmark grid. Distinctive without being clever.
 */
export function drawDirectionX2(ctx, size) {
  const s = size / 1024;

  ctx.fillStyle = PALETTE.graphite;
  roundedRectPath(ctx, 0, 0, size, size, CORNER_RATIO * size);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineWidth = 80 * s;

  // Top bar — cream, longest (the "header" / category)
  ctx.strokeStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.moveTo(240 * s, 380 * s);
  ctx.lineTo(760 * s, 380 * s);
  ctx.stroke();

  // Middle bar — moss-green, medium (the carbon value)
  ctx.strokeStyle = PALETTE.mossAccent;
  ctx.beginPath();
  ctx.moveTo(240 * s, 512 * s);
  ctx.lineTo(620 * s, 512 * s);
  ctx.stroke();

  // Bottom bar — cream, slightly shorter than top (another entry)
  ctx.strokeStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.moveTo(240 * s, 644 * s);
  ctx.lineTo(700 * s, 644 * s);
  ctx.stroke();
}

// ──────────────── Direction X3 — "C" with crossbar (hybrid) ────────────────

/**
 * The bold-C of X1 with a single small horizontal bar inside the
 * bowl — the bar suggests the "ledger entry" motif of X2 living
 * inside the letterform. The bar is moss green; everything else is
 * cream on forest green.
 *
 * Carries semantic narrative: "C" (CarbonInk) wraps around the line
 * of recorded data. Still reads as a single mark at 16×16 because
 * the bar is large enough to register as a horizontal accent inside
 * the C, not as a separate floating element.
 */
export function drawDirectionX3(ctx, size) {
  const s = size / 1024;

  // Forest-green background
  ctx.fillStyle = PALETTE.forestGreen;
  roundedRectPath(ctx, 0, 0, size, size, CORNER_RATIO * size);
  ctx.fill();

  // The C — same geometry as X1
  ctx.strokeStyle = PALETTE.cream;
  ctx.lineWidth = 130 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(512 * s, 512 * s, 265 * s, -Math.PI * 0.28, Math.PI * 0.28, true);
  ctx.stroke();

  // Moss-green crossbar inside the C bowl. Sits horizontally on the
  // center axis, short enough that it doesn't crowd the C's curve.
  ctx.strokeStyle = PALETTE.mossAccent;
  ctx.lineWidth = 70 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(390 * s, 512 * s);
  ctx.lineTo(610 * s, 512 * s);
  ctx.stroke();
}
