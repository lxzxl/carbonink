---
name: carbonink-mcp
description: Use when the user asks about THEIR carbon-accounting data inside CarbonInk (碳墨) — questionnaires/问卷, emission sources/排放源, activity data/活动数据, answers, Scope 1/2/3 totals, GHG inventory, ISO 14064-1 reports, or emission factors (EF). Maps user questions to the carbonink MCP server's nine tools instead of grepping the CarbonInk repository. Skip when the user is asking about the CarbonInk source code.
---

<!-- managed by CarbonInk -->

# CarbonInk MCP Access

CarbonInk (碳墨) is a desktop carbon-accounting app for ISO 14064-1 /
GHG Protocol greenhouse-gas inventories. Each install owns a local SQLite
database with the user's questionnaires, emission sources, activity data,
answers, and pinned emission factors. The data is exposed to agents through an
MCP server registered as **`carbonink`**.

## When to invoke

Use the carbonink MCP tools when the user asks about **their own carbon data**:

- "How many questionnaires do I have?" / "我有多少份问卷？"
- "What are my Scope 1/2/3 emissions for {year}?"
- "List my emission sources" / "列出排放源"
- "Show activities for Q3" / "Q3 的活动数据"
- "What's the answer to question {id}?"
- "Add a new activity…" / "新增一条活动数据…"
- "Help me fill questionnaire {id}" / "帮我填问卷 {id}"

**Do not invoke** for questions about the codebase itself; use file search.

## Tools (server: `carbonink`)

| Tool | Purpose | Required args |
|---|---|---|
| `list_questionnaires` | List questionnaires (customer, year, status, question_count) | none |
| `get_questionnaire` | Full detail including questions and document | `id` |
| `list_questions` | Questions in one questionnaire | `questionnaire_id` |
| `get_answer` | One question's answer (null when unanswered) | `question_id` |
| `list_activities` | Activity rows, optionally filtered | `reporting_period_id?` or `year?` |
| `list_emission_sources` | Emission sources, optionally filtered | `organization_id?` |
| `set_answer` | Write or update an answer | `question_id`, `value`; optional `unit`, `finalize` |
| `create_activity` | Insert an activity; CO2e is computed from the pinned EF | `emission_source_id`, `reporting_period_id`, `occurred_at_start`, `occurred_at_end`, `amount`, `unit`, `ef_factor_code`, `ef_year`, `ef_source`, `ef_geography`, `ef_dataset_version`; optional `fuel_code`, `notes` |
| `create_emission_source` | Insert an emission source | `site_id`, `name`, `scope: 1\|2\|3`; optional `category`, `ghg_protocol_path` |

Resources:

- `inventory://{year}` — aggregated emissions totals for that reporting year
- `questionnaire://{id}` — full detail for one questionnaire

## Common workflows

### "Total Scope 1 emissions for 2025"

1. `list_activities` with `year: 2025`.
2. `list_emission_sources` to map `emission_source_id → scope`.
3. Sum `computed_co2e_kg` for scope 1; report kilograms and say so.

`inventory://2025` gives the same totals directly when the year exists.

### "Help me fill questionnaire X"

1. `get_questionnaire` with `id: X`.
2. `get_answer` per question to see what is already filled.
3. Reason about the value, then **confirm with the user before writing**.
4. `set_answer` with `value` (and `unit` when needed). Only set
   `finalize: true` after explicit approval: it locks the answer into the
   snapshot used for export.

### "Add an activity: 1000 kWh grid electricity in March 2025"

`create_activity` requires a complete pinned EF tuple. If the user has not
pinned that factor in the GUI, tell them: "Open CarbonInk → New Activity → pick
the EF once in the GUI; future similar activities can then be created through
MCP." A cross-family unit change (for example litres against a per-kg factor)
also needs `fuel_code`.

## Safety

- **Mutating tools** write to the user's SQLite through the desktop app. Always
  confirm before calling them, especially in batches.
- Writes require the CarbonInk app to be running; read tools work with it
  closed.
- `set_answer` with `finalize: true` is hard to undo; unfinalize in the UI.
- Reads and resources are safe to call freely.

## Naming and units

- "Survey" ≡ "questionnaire" ≡ "问卷".
- Scope is the integer `1`, `2`, or `3`.
- CO2e values are **kg** unless a tool says otherwise.
- The server name is `carbonink`; the legacy repo name `carbonbook` is not
  the server name.

## Checking the wiring

1. In CarbonInk, open **Settings → Agent integration** and configure the
   client you use (Claude Desktop, Claude Code, Cursor) and install the skill.
2. The server command is the CarbonInk executable with the single argument
   `--mcp`.
3. `CARBONINK_MCP_DB` overrides the workspace file for testing;
   `CARBONINK_DATA_DIR` overrides the data directory.
4. Pi: install `pi-mcporter`; it discovers `carbonink` from `~/.claude.json`.
