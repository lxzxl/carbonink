# State-machine & UI intuitiveness review

**Date:** 2026-05-29 · **Scope:** every `status`/state field in the schema + the
renderer surfaces that present them. **Method:** traced each status enum
(migrations) → its transition points (services) → its user-facing label (paraglide)
→ how it renders (routes). Goal: find where the design fights the user's mental
model, and propose concrete fixes. Recommendations are prioritized; nothing here
is implemented yet.

---

## 1. State-machine inventory (ground truth)

| Entity | DB enum (migration) | Reachable? | User-facing labels |
|---|---|---|---|
| **document / extraction** (`003`) | `pending · parsed · review_needed · rejected` | all | 待审核 / **已确认** / 已丢弃 ; + virtual 无抽取 · 未分类 ; **`pending` has NO label** |
| **questionnaire — outbound** (`005`) | `parsing · mapping · answering · exported` | **`parsing` is DEAD** — rows are INSERTed at `'mapping'` (`questionnaire-service.ts:214`) | 解析中 / 映射中 / 答题中 / 已导出 |
| **questionnaire — inbound** (`017`) | `draft · sent · received · ingested` | all | 草稿 / 已发送 / 已回收 / 已入库 (hardcoded, not i18n) |
| **answer.finalized_at** | null = draft, timestamp = finalized | — | "草稿/已确认" per row |
| **activity_data.source_kind** | one table `mapped_inventory·manual·ai_suggested`, another adds `·reused` | — | — |
| **organization.boundary_kind** | one site `equity_share·financial_control·operational_control`, another `equity_share·operational_control` | — | — |
| **audit_event** | append-only (UPDATE/DELETE blocked by triggers, `006`) | — | — |

---

## 2. Findings, by severity

### 🔴 HIGH — breaks the user's mental model

**H1. One `questionnaire.status` column carries two unrelated vocabularies.**
Outbound speaks in pipeline verbs (`parsing/mapping/answering/exported`); inbound
speaks a clean real-world lifecycle (`draft→sent→received→ingested`). Same column,
two mental models, discriminated only by `direction`. The inbound model is the good
one — it reads like a story (you draft it, send it, get it back, file it in) and
every state has an obvious next action. Outbound should be re-modeled to match.

**H2. "确认全部答案" lands the questionnaire in an *in-progress* state — and touches no answers.**
The page's hero (filled-green) button → `questionnaire:finalize` →
`finalizeAnswering()` runs exactly `UPDATE questionnaire SET status='answering'`
(`questionnaire-service.ts:307-309`). Problems stacked here:
- `answering` = "答题中" (in-progress). A *confirm/finalize* action should produce a
  *done* state, not move you into "still answering." Outbound has **no** terminal
  "confirmed/locked" state before `exported`.
- The label says "confirm **all answers**," but the handler never iterates answers
  and never sets any `answer.finalized_at`. (Answer-level finalize is real and lives
  elsewhere — set on generate/save, cleared by `answer:unfinalize`,
  `answer-generation/index.ts:215,231,335`.) So the button over-promises twice.
- It sets `'answering'` unconditionally, so clicking it on an already-`exported`
  questionnaire silently regresses the status.

**H3. Outbound detail page leaks the raw enum.** `questionnaires.$id.tsx:193`
renders `{questionnaire.status}` directly → the user sees `answering` / `exported`
(lowercase English) in the header, while the *list* shows the translated 答题中 via
`statusLabel()`. Inconsistent, and exposes an internal token.

**H4. Nav says "披露填报"; every page under it says "问卷".** The sidebar item is
`披露填报` (`sidebar-data.ts:67`) but the pages use 问卷 throughout — 返回问卷列表,
问卷不存在, 还没有问卷, 新建问卷 (14 strings in `zh-CN.json`). A user clicks one word
and lands on another. (`nav_questionnaires`="问卷" is now a **dead key**, 0 uses.)

### 🟡 MEDIUM — confusing but not broken

**M1. `document.status='pending'` has no label.** The enum value exists (`003`) but
there's no `documents_status_pending` key — a queued/in-flight extraction renders
with a missing/blank status.

**M2. Enum name vs label skew: `parsed` → "已确认".** The DB says *parsed* (AI did
it); the UI says *confirmed* (user approved it). Reasonable as UX, but the token and
the meaning diverge — easy to misread in code/audit.

**M3. Divergent enums across tables.** `source_kind` includes `reused` in one table
but not another; `boundary_kind` allows `financial_control` in one place but not the
other. Either intentional (then document why) or drift (then align). Today it's
silent drift → confusing validation surprises.

**M4. Inbound UI is hardcoded Chinese, outbound is i18n.** Already tracked as v2.1
debt (ROADMAP §4.5). Listed here because it's part of the same "consistency" theme.

### 🟢 LOW — polish

**L1. Outbound action-bar emphasis is inverted.** The filled-green primary is
"确认全部答案" (does the least); the thing the user actually wants — export the filled
questionnaire to send back — is `outline`. Primary should be the real goal.

**L2. Document "status" is a blend of `extraction.status` + virtual states**
(无抽取/未分类). Works, but worth documenting so the blend isn't mistaken for the DB
enum.

**L3. Dead state `parsing` + dead key `nav_questionnaires`** — remove or wire up.

### ✅ What's already right — use as the template

The **inbound action bar** (`supplier-disclosures.$id.index.tsx:191-266`) is the
model to copy everywhere: exactly one clear primary per status (draft→导出空白 xlsx,
sent→导入回填表, received→审核并入库, ingested→查看关联活动数据), the destructive
delete held apart on the left, and a cascade-aware confirm dialog. This is intuitive
because each state answers "what do I do next?" with one button.

---

## 3. Recommendations

**R1 (H1+H2+H3 — the big one): re-model the outbound lifecycle to mirror inbound.**
Proposed reachable states + labels:

| status | label | meaning | how you leave it |
|---|---|---|---|
| `draft` | 草稿 | imported from the customer's blank form (replaces `parsing`/`mapping`) | generate/fill answers |
| `answering` | 填写中 | answers being drafted | click **确认全部答案** |
| `finalized` | **已定稿** | answers locked (NEW terminal-ish state) | export |
| `exported` | 已导出 | sent back to the customer | — |

Then make **确认全部答案** actually mean it: move `answering → finalized` **and** stamp
`finalized_at` on every answer in the questionnaire (the bulk version of the existing
per-answer finalize). Block the regress (don't let it run from `exported`). This
single change resolves H2 entirely and gives outbound the same legible arc as inbound.
Cost: a status-CHECK migration (table-recreate, same shape as `017`).

**R2 (H3): one shared, translated `<StatusBadge status>`** used by both list and
detail, for both directions. No route renders `{questionnaire.status}` raw again.

**R3 (H4): pick ONE term and sweep it.** Recommend standardizing on **披露填报 /
披露** (it was the deliberate rename and pairs with 供应商披露): rename the 14 page
strings (返回披露列表 / 披露不存在 / 还没有披露 / 新建披露…) and delete the dead
`nav_questionnaires` key. (If you'd rather keep 问卷 as the friendlier word, do the
reverse — but don't keep both.)

**R4 (M1+M2+L3): tidy the enums/labels.** Add `documents_status_pending` (e.g.
"抽取中"); decide whether to rename DB `parsed`→`confirmed` or just accept the label;
drop the dead `parsing` value next time `005`/`017` is touched.

**R5 (M3): make the enum divergences a deliberate decision.** Align `source_kind`
and `boundary_kind` across tables, or add a one-line comment in each migration
explaining why they differ.

**R6 (L1): flip the outbound action-bar hierarchy** once R1 lands — make **导出**
(or "确认并导出") the filled primary; 确认全部答案 and the AI/PDF actions go `outline`.

**R7 (principle): adopt the inbound pattern as the house style for stateful entities** —
real-world-noun lifecycle, one primary action per state answering "what next?",
translated badge everywhere, destructive actions held apart. Apply it to the
document review flow too (pending→review_needed→confirmed/discarded) for symmetry.

---

## 4. Suggested sequencing

1. **Quick wins first** (no migration): R2 (StatusBadge / fix raw leak H3), R3
   (terminology sweep H4), M1 (pending label), L3 (dead key). High intuitiveness gain,
   low risk.
2. **The lifecycle re-model** R1 (+R6) — needs a migration + answer-finalize wiring +
   tests; spec it (`docs/specs/`) before coding, per the repo workflow.
3. **Enum hygiene** R4/R5 — fold into whichever migration touches those tables next.
