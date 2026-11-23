# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

ESG / sustainability **consultants** are the primary user — professionals who
run GHG inventories on behalf of multiple client companies. They are power
users: deadline-driven, working across many sources and questionnaires at once,
and held to an auditable standard. **In-house sustainability staff** at SMEs and
enterprises are the secondary user, compiling their own company's emissions for
a report or a supplier disclosure; they are less specialized and need more
guidance.

The product defaults to expert density and speed, with guardrails so the
less-expert user is never lost.

Context of use: a native desktop app (macOS / Windows), often for long focused
sessions — importing receipts, invoices and questionnaires, matching emission
factors, and assembling an ISO 14064-1 inventory toward a reporting deadline.
Work is bilingual, with zh-CN primary and en parity.

## Product Purpose

CarbonInk (碳墨) turns messy real-world evidence — receipts, invoices, supplier
questionnaires — into a defensible greenhouse-gas inventory. AI extraction and
emission-factor matching remove the manual toil; the lifecycle (draft →
finalized → exported) and the report/export layer produce ISO 14064-1 and
disclosure-ready output.

Success is **audit-grade confidence**: every number traces back to its source
document and the emission factor that produced it, and the resulting inventory
survives third-party verification. Trust beats raw speed — the AI accelerates
the drudgery, but every result stays visible, correctable, and accountable. The
`audit_event` trail (tool names, IDs, counts, decision flags — never prompt
content) is part of this promise, not an afterthought.

## Positioning

A free, open-source (MIT), local-first desktop ledger for GHG accounting. The
claim a neighboring commercial product could not truthfully copy:

- **The data never leaves the machine.** No account, no cloud sync, no
  subscription, no license gate or activation.
- **The model is the user's choice.** Extraction runs on a bring-your-own LLM
  API key; the product does not resell or proxy intelligence as the business.
- **Every figure carries provenance.** Each derived value links back to its
  source document, the pinned emission factor, and the calculation snapshot
  that produced it, so the inventory can be defended line by line.

Trust is the product; AI is the accelerator, not the authority.

## Operating Context

- macOS and Windows desktops, used in long focused sessions by people who
  already know the accounting domain.
- One workspace per client; several client inventories, documents and
  questionnaires in flight at the same time.
- Evidence arrives as utility bills, fuel receipts, freight and travel
  documents, purchase records, and supplier questionnaires — often PDFs,
  spreadsheets, or scans.
- Emission factors come from built-in libraries and from user-imported factor
  libraries; factors are matched, reviewed, and sometimes rebound.
- Outbound disclosure questionnaires are filled from the inventory; inbound
  supplier Scope 3 Category 1 data is collected and tracked.
- Reports are produced as ISO 14064-1 inventory reports and TCFD reports, with
  PDF / XLSX export.
- The inventory is exposed to external agents (Claude, Cursor, Pi) through a
  built-in MCP server, and the app offers a command palette as a first-class
  path for power users.
- The interface is bilingual (zh-CN + en); both locales are exercised on every
  layout.

## Capabilities and Constraints

Confirmed capabilities:

- Inventory: organizations, sites, reporting periods, emission sources,
  activity data, emission-factor matching and rebinding, lineage views.
- AI extraction: bring-your-own key, batch extraction queue, document intake
  and prefill, with human review before values land.
- Documents: import, preview, and evidence links back to the activity rows.
- Questionnaires: outbound disclosure answers, inbound supplier data,
  overdue tracking, PDF / XLSX export.
- Reports: ISO 14064-1 and TCFD, with a readiness review before export.
- Client workspaces, backup / restore, undo / redo, and an audit trail.
- MCP server, agent bridge, and command palette.

Constraints:

- **macOS and Windows only.** Other operating systems are out of scope for the
  product. The UI engine (NSGo) is an implementation detail, not a product
  claim; what matters is that the app behaves natively on each OS.
- **Local storage only.** A local SQLite database per workspace; no server-side
  account, no cloud sync, no multi-user collaboration.
- **`audit_event` payloads carry no prompt content** — only tool names, IDs,
  counts, and decision flags. Organization identity is injected server-side,
  never supplied by the user.
- **Bilingual parity is structural.** Every string ships in both en and zh-CN
  in the same change; layouts must hold for both.
- **Free and open source (MIT).** There is no license gate, activation, account,
  or payment surface anywhere in the product.

## Brand Commitments

- **Name:** CarbonInk · 碳墨.
- **Voice:** factual, specific, unhurried. It states what a number is and where
  it came from; it does not sell, cheerlead, or hedge.
- **Personality:** calm, precise, native — a quiet expert tool that lets the
  data lead. The forest-green / moss-green brand is a quiet accent, not a
  flood.
- **Craft reference:** the Stripe Dashboard — dense financial and operational
  data presented calmly and legibly, with tables and detail views done right.
  Borrow that quality, not its specific look.
- **Anti-references:** a flashy SaaS marketing dashboard (hero-metric template,
  decorative gradients, glassmorphism for show); consumer-app cuteness
  (mascots, bouncy motion, emoji-as-UI); web-app tells in a native shell;
  hierarchy-free walls of spreadsheet cells.
- **No licensing or account surface** may be reintroduced.

## Evidence on Hand

- The product itself: `app/internal/**` (inventory, extraction, efmatch,
  questionnaire, inbound, report, readiness, lineage, mcp), with Go tests and
  NSGo UI tests covering the flows.
- Bilingual catalogs: `app/locales/en.yaml` and `app/locales/zh-CN.yaml`.
- Design and behavior specs in `docs/specs/` and `docs/plans/` (local-only).
- Product screenshots under `cloud/web/public/screenshots/{en,zh}/` show the
  1.x interface; they are a content and flow reference, not a visual spec for
  the native app.
- No testimonials, customer logos, benchmarks, or press assets exist. Do not
  fabricate any.

## Product Principles

1. **Evidence before automation.** AI may propose, but the user confirms. Every
   extracted or matched value stays visible, editable, and tied to its source.
2. **Provenance is a first-class surface.** Being able to follow a number back
   to document, factor, and snapshot matters as much as the number itself.
3. **Local and accountless by default.** No login, no upload, no metering. The
   app works with the network off except where the user explicitly calls a
   model or a lookup.
4. **One workspace, one client.** Client context is isolated and switchable;
   nothing from one client's inventory leaks into another's.
5. **Calm density.** Show a lot at once without noise, and never make the
   expert pay for guidance aimed at the novice — or the reverse.

## Accessibility & Inclusion

- **WCAG AA contrast as a hard floor**, in both light and dark themes: body
  text ≥ 4.5:1, large text ≥ 3:1, placeholders held to the body floor.
- **Bilingual zh-CN / en parity.** CJK and Latin string lengths must both fit
  without clipping; the CJK + Latin font stack is preserved.
- **Reduced motion** is honored; every animation needs a crossfade or instant
  alternative.
- **Never encode meaning in color alone.** Status and lifecycle states pair an
  icon and/or label with their color.
- **Full keyboard operability** is the direction of travel: reachable flows,
  visible focus, and the command palette as a first-class path.
