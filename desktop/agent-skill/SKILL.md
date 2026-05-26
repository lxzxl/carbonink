---
name: carbonink-mcp
description: Use when the user asks about THEIR carbon-accounting data inside CarbonInk (碳墨) — questionnaires/问卷, emission sources/排放源, activity data/活动数据, answers, Scope 1/2/3 totals, GHG inventory, ISO 14064-1 reports, or emission factors (EF). Maps user questions to the carbonink MCP server's 9 tools instead of grepping the carbonink repository codebase. Skip when the user is asking about the carbonink source code (use Read/Grep for that).
---

# CarbonInk MCP Access

CarbonInk (碳墨, English brand: CarbonInk) is a desktop carbon accounting app
for ISO 14064-1 / GHG Protocol greenhouse-gas inventories. Each install owns a
local SQLite database containing the user's questionnaires, emission sources,
activity data, calculated answers, and emission factor pinnings. The data is
exposed to AI agents through an MCP server registered as **`carbonink`**.

## When to invoke

Use the carbonink MCP tools whenever the user is asking about **their own
carbon data** (not the source code of the app). Triggers include:

- "How many questionnaires/surveys do I have?" / "我有多少份问卷？"
- "What are my Scope 1/2/3 emissions for {year}?" / "{年份}范围一/二/三的排放是多少？"
- "List my emission sources" / "列出排放源"
- "Show activities for Q3" / "Q3 的活动数据"
- "What's the answer to question {id}?" / "{问题}的答案是什么？"
- "Add a new activity..." / "新增一条活动数据..."
- "Help me fill questionnaire {id}" / "帮我填问卷 {id}"
- "What's pinned as the EF for {activity}?" / "{活动}用的排放因子是？"

**Do not invoke** when the user is asking about the code itself ("how does the
extraction service work", "where is X defined") — use file search instead.

## Tool catalog (server name: `carbonink`)

| Tool | Purpose | Required args |
|---|---|---|
| `list_questionnaires` | List all questionnaires (customer, reporting_year, status, question_count) | none |
| `get_questionnaire` | Full detail including questions and document | `id` |
| `list_questions` | Questions in one questionnaire | `questionnaire_id` |
| `get_answer` | Answer for a single question (null if not filled) | `question_id` |
| `list_activities` | Activity rows; optionally filtered | `reporting_period_id?` or `year?` |
| `list_emission_sources` | Emission sources; optionally filtered | `organization_id?` |
| `set_answer` | Write or update an answer | `question_id`, `value`; optional `unit`, `finalize` |
| `create_activity` | Insert new activity row; auto-computes co2e from pinned EF | `site_id`, `emission_source_id`, `reporting_period_id`, `occurred_at_start`, `occurred_at_end`, `amount`, `unit`, `ef_factor_code`, `ef_year`, `ef_source`, `ef_geography`, `ef_dataset_version`; optional `notes` |
| `create_emission_source` | Insert new emission source | `site_id`, `name`, `scope: 1\|2\|3`; optional `category`, `ghg_protocol_path` |

Also two MCP **resources**:

- `inventory://{year}` — aggregated emissions totals for that reporting year
- `questionnaire://{id}` — full detail for one questionnaire

## How to call (varies by agent host)

**Most MCP clients** (Claude Desktop, Claude Code, Cursor, Continue, etc.):
each tool above is exposed as a top-level callable. Just call by name:
`list_questionnaires`, `get_answer({question_id: "..."})`, etc.

**Pi (via [pi-mcporter](https://github.com/mavam/pi-mcporter))**: pi-mcporter
collapses all MCP servers behind a single `mcporter` tool with three actions.
Use:

```json
{ "action": "call", "selector": "carbonink.list_questionnaires", "args": {} }
```

If you don't yet know which selector to use, first
`{ "action": "search", "query": "carbonink", "limit": 10 }` to enumerate.

**Generic MCP**: query the server named `carbonink`. Tool inputSchemas are
JSON Schema; the server will reject mismatched args.

## Common workflows

### 1. "How many surveys do I have?"

Call `list_questionnaires` → count rows → answer.

Don't grep the codebase. Don't ask about "survey" types in TypeScript files.
"Survey" in this app means **questionnaire (问卷)**.

### 2. "Total Scope 1 emissions for 2025"

1. `list_activities` with `year: 2025`
2. `list_emission_sources` to map `emission_source_id → scope`
3. Sum `co2e_kg` of activities where the source's scope is `1`

### 3. "Help me fill questionnaire X"

1. `get_questionnaire` with `id: X` to see questions + context
2. For each question: `get_answer` to see current value
3. Reason about the right value; **confirm with the user before writing**
4. `set_answer` with `value` (+ `unit` if needed). Only set `finalize: true`
   after the user has explicitly approved finalization (it locks the answer
   into the snapshot used for export).

### 4. "Add an activity: 1000 kWh China grid electricity in March 2025"

`create_activity` is strict — it requires a complete pinned EF tuple. If the
user hasn't already pinned one in the GUI, you cannot create the activity
through MCP. Tell the user: "Open CarbonInk → New Activity → pick the EF once
in the GUI; future similar activities will reuse the pinned EF and I can
create them through MCP."

## Safety

- **Mutating tools** (`set_answer`, `create_activity`, `create_emission_source`)
  write directly to the user's local SQLite. **Always confirm with the user
  before calling them**, especially when batching multiple writes.
- All writes are recorded in `audit_event` and most are reversible from the
  CarbonInk desktop UI (⌘Z / Edit → Undo). But MCP-originated writes might
  not always be in the desktop session's undo stack — prefer dry-runs.
- `set_answer` with `finalize: true` locks the answer; reversal requires
  explicit unfinalize from the UI.
- Read tools (`list_*`, `get_*`) and resources are safe to call freely.

## Naming gotchas

- The app's git repo is called **`carbonbook`** (legacy name); the package and
  MCP server are **`carbonink`**. Use `carbonink` for MCP selectors.
- "Survey" ≡ "questionnaire" ≡ "问卷". User-facing UI is bilingual zh-CN/en.
- Scope is always an integer `1`, `2`, or `3` (never strings).
- Co2e values returned in **kg** unless tool docs say otherwise.

## How to check this server is wired up

If a tool call returns "unknown tool" or "server not found":

1. `carbonink` server is expected at `<CarbonInk binary>` with arg
   `out/mcp/index.js` and env `ELECTRON_RUN_AS_NODE=1`. The user can set this
   up from **CarbonInk → Settings → MCP integration** (auto-config for
   Claude Desktop, Claude Code, Cursor; manual link for Pi via pi-mcporter).
2. The user must have launched CarbonInk at least once so the SQLite file
   exists at `~/Library/Application Support/CarbonInk/app.sqlite` (macOS) /
   `%APPDATA%/CarbonInk/app.sqlite` (Windows) / `~/.config/CarbonInk/app.sqlite`
   (Linux).
3. Override DB path for testing via `CARBONINK_MCP_DB` env var.
