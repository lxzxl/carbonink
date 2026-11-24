# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (macOS / Windows)

## Users & Operating Context

- **Primary users:** ESG / sustainability consultants running audit-grade GHG inventories across multiple client companies in long, deadline-driven desktop sessions.
- **Secondary users:** In-house sustainability staff compiling their own company's inventory, supplier disclosures, or reports — less specialized and served by clear guardrails.
- **Workflow:** Bilingual (`zh-CN` / `en` parity). Users import real-world evidence (utility bills, fuel receipts, freight/travel docs, supplier questionnaires), match or rebind emission factors, move entries through `draft → finalized → exported`, and generate ISO 14064-1 / TCFD reports or filled disclosure workbooks.

## Positioning & Purpose

CarbonInk (碳墨) is a free, open-source (MIT), local-first desktop ledger for GHG accounting:

- **Data stays local:** SQLite per workspace on the user's machine; no cloud account, sync, subscription, or license gate.
- **Bring your own model:** AI extraction and ranking accelerate manual toil using the user's own LLM API key, while every figure remains visible, editable, and verifiable.
- **Audit-grade provenance:** Every derived emission figure traces back to its source document, pinned emission factor, and calculation snapshot. `audit_event` records tool names, IDs, counts, and decision flags — never prompt content.

## Product Principles

1. **Traceable by default.** Every derived value links to its source evidence and emission factor; provenance and correction are first-class.
2. **Calm density.** Expert scanability through type scale, whitespace, and hairline rules rather than heavy chrome or color floods.
3. **Native, not web.** Respect OS conventions in chrome, cursors, typography, and motion.
4. **Guide the novice, don't slow the expert.** Keyboard shortcuts and command palette speed paired with clear onboarding and inline guardrails.
5. **Bilingual parity is structural.** Every screen and string ships in both `zh-CN` and `en` without clipping or missing keys.

## Brand & Accessibility

- **Tone & Craft:** Factual, unhurried, precise (**Stripe Dashboard** level of data clarity; no SaaS marketing hype, decorative gradients, or consumer-app cuteness).
- **Hard accessibility rules:** WCAG AA contrast floor (≥4.5:1 body, ≥3:1 large text); never encode meaning in color alone (pair status/scope colors with icons or labels); honor reduced motion; maintain full keyboard operability.
- **Evidence on hand:** Real invoice/receipt schemas, emission factor databases, activity datasets, and ISO 14064-1 / TCFD report generators — never fabricate testimonials, customer logos, or mock metrics.

> For the NSGo 2.0 desktop app specifics, see [app/PRODUCT.md](app/PRODUCT.md).
