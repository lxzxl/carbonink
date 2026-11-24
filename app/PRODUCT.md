# Product (CarbonInk 2.0 / NSGo)

<!-- impeccable:product-schema 1 -->

## Platform

adaptive (native macOS / Windows desktop via NSGo)

## Users & Operating Context

- **Primary users:** ESG / sustainability consultants managing isolated per-client SQLite workspaces across multiple inventories and deadlines.
- **Secondary users:** In-house sustainability staff compiling company emissions and supplier disclosures, supported by onboarding and inline guidance.
- **Bilingual parity:** `zh-CN` and `en` in every YAML catalog (`app/locales/{en,zh-CN}.yaml`) and layout; both locales are verified across desktop and narrow windows.

## Capabilities & Constraints

- **Inventory & Provenance:** Organizations, sites, reporting periods, emission sources, activity ledger, emission-factor matching/rebinding, and lineage views.
- **AI Extraction & Matching:** Bring-your-own LLM key, batch extraction queue, document intake/preview, and prefill with human review before saving.
- **Disclosures & Reports:** Outbound questionnaire answering, inbound supplier Scope 3 Cat 1 collection with overdue tracking, ISO 14064-1 and TCFD reports, readiness review, and PDF / XLSX / deliverable export.
- **Power-User & Workspace Tooling:** Client workspaces, backup/restore, undo/redo, command palette (`⌘K` / `Ctrl+K`), built-in MCP server, and agent bridge.
- **Hard constraints:**
  - **macOS and Windows only** (native OS behavior over web-app tells; NSGo is an implementation detail, not a marketing claim).
  - **Local-first & FOSS (MIT):** No account, cloud sync, license gate, or payment surface.
  - **`audit_event` hygiene:** Records tool names, IDs, counts, and decision flags — never prompt content; organization ID is server-injected.

## Principles & Brand

- **Brand:** CarbonInk · 碳墨 — calm, precise, native. Quiet emerald accent (`#008c4f` light / `#00af67` dark); factual, unhurried copy. Craft reference: Stripe Dashboard's calm data density (quality, not literal visuals).
- **Principles:**
  1. **Evidence before automation.** AI proposes; the user confirms.
  2. **Provenance is first-class.** Every figure traces back to document, factor, and snapshot.
  3. **Local and accountless by default.** Offline except explicit model or routing calls.
  4. **One workspace, one client.** Isolated client databases with zero cross-leakage.
  5. **Calm density.** Dense data without visual noise; novices get guidance without slowing experts.
- **Accessibility:** WCAG AA contrast floor in light and dark themes, color always paired with icon/label, reduced motion honored, full keyboard operability.
- **Evidence on hand:** Implemented in `app/internal/**` with Go + `nsgotest` suites, `app/locales/{en,zh-CN}.yaml`, and `cloud/web/public/screenshots/{en,zh}/` (1.x flow reference). Never fabricate testimonials or metrics.
