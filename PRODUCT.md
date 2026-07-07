# Product

## Register

product

## Users

ESG/sustainability **consultants** are the primary user — professionals (e.g. at
Seneca ESG) who run GHG inventories on behalf of multiple client companies. They
are power users: deadline-driven, working across many sources and questionnaires
at once, and held to an auditable standard. **In-house sustainability staff** at
SMEs/enterprises are the secondary user, compiling their own company's emissions
for a report or a supplier disclosure; they are less specialized and need more
guidance. The product defaults to expert density and speed, with guardrails so
the less-expert user is never lost.

Context of use: a desktop app (macOS/Windows), often for long focused sessions —
importing receipts, invoices and questionnaires, matching emission factors, and
assembling an ISO 14064-1 inventory toward a reporting deadline. Work is
bilingual (zh-CN primary, en parity).

## Product Purpose

CarbonInk (碳墨) turns messy real-world evidence — receipts, invoices, supplier
questionnaires — into a defensible greenhouse-gas inventory. AI extraction and
emission-factor matching remove the manual toil; the lifecycle (草稿 → 已定稿 →
已导出) and the report/export layer produce ISO 14064-1 / disclosure-ready output.

Success is **audit-grade confidence**: every number traces back to its source
document and the emission factor that produced it, and the resulting inventory
survives third-party verification. Trust beats raw speed — the AI accelerates the
drudgery, but every result stays visible, correctable, and accountable. The
`audit_event` trail (tool names, IDs, counts, decision flags — never prompt
content) is part of this promise, not an afterthought.

## Brand Personality

**Calm. Precise. Native.** A quiet expert tool that lets the data lead.

- **Voice/tone**: factual, specific, unhurried. It states what a number is and
  where it came from; it does not sell, cheerlead, or hedge.
- **Feel**: a first-class macOS/Windows native app — restrained, dense-but-legible,
  with motion and materials that read as the OS rather than as a web page. The
  forest-green brand is a quiet accent, not a flood.
- **North-star craft reference**: the **Stripe Dashboard** — dense financial /
  operational data presented calmly and legibly, with tables and detail views
  done right. We borrow that quality (calm density, trustworthy data display),
  not its specific look.

## Anti-references

- **Flashy SaaS marketing-dashboard.** No hero-metric template (giant number +
  gradient + supporting stats), no decorative gradients, no glassmorphism for
  show. Marketing energy lives in `cloud/web`, never in the app shell.
- **Consumer-app cuteness.** No playful mascots, bouncy/elastic motion, or
  emoji-as-UI. The audience is professional and the stakes are auditable.
- **Web-app tells.** No `cursor: pointer` on app-shell chrome, no painted CSS
  window corners, no font choices that fight the OS. If it looks like a website
  in a window, it's wrong (see the lengths `globals.css` already goes to here).
- **Undifferentiated enterprise spreadsheet.** Dense is good; illegible,
  hierarchy-free walls of cells are not. Density must stay calm and scannable.

## Design Principles

1. **Traceable by default.** Every derived value can be followed back to its
   evidence (source doc, emission factor, activity). UI surfaces provenance and
   makes correction first-class, because the inventory has to be defensible.
2. **Calm density.** Show consultants a lot at once without noise — hierarchy
   through type scale, weight, and spacing, not through color or chrome. Borders
   and tints over heavy lines and cards.
3. **Native, not web.** Match the OS in chrome, cursors, fonts, materials, and
   motion. The bar is "indistinguishable from a native app," and the existing
   code already pays this tax — don't regress it.
4. **Guide the novice, don't slow the expert.** Keyboard paths, sensible
   defaults, and command-palette reach for power users; clear empty/onboarding
   states and plain-language guidance for the in-house occasional user. Neither
   audience pays for the other.
5. **Bilingual parity is structural.** Layouts must hold for both Chinese and
   English string lengths in the same commit — no truncation, no overflow, keys
   in both `messages/en.json` and `messages/zh-CN.json`.

## Accessibility & Inclusion

- **WCAG AA contrast as a hard floor**, in both light and dark themes: body text
  ≥4.5:1, large text ≥3:1, placeholders held to the body floor. Watch muted-gray
  body on tinted near-white — the most common failure.
- **Bilingual zh-CN / en parity.** Every layout is validated in both locales;
  CJK and Latin string lengths must both fit without clipping. CJK + Latin font
  stacks are already tuned in `globals.css` — preserve that selection logic.
- **Reduced motion** is honored (the global `prefers-reduced-motion` reset is in
  place); every new animation needs a crossfade/instant alternative.
- **Never encode meaning in color alone.** Status and lifecycle states pair an
  icon and/or label with their color so color-blind users aren't excluded.
- **Full keyboard operability** is the direction of travel: reachable flows,
  visible focus rings, command palette as a first-class path.
