# CarbonInk Agent Skill

A portable [Agent Skill](https://agentskills.io/specification) that teaches AI
agents how to query CarbonInk's carbon-accounting data through its MCP server
instead of grepping the codebase. Works with any agent host that supports the
Agent Skills standard.

## What it does

When a user asks an AI agent about their **carbon data** — questionnaires,
emission sources, activity records, Scope 1/2/3 totals, EF pinnings — the
agent loads this skill on demand. The skill maps the user's natural-language
question (Chinese or English) to the right MCP tool call against the
`carbonink` server.

Without this skill, agents in code-repo contexts (e.g. pi started inside the
carbonbook checkout) tend to reflexively grep TypeScript files for "survey" or
"questionnaire" instead of querying the actual data. With it, the question
"how many questionnaires do I have?" goes straight to `list_questionnaires`.

## Prerequisites

The carbonink MCP server must be wired up to the agent's host first. From
**CarbonInk → Settings → MCP integration**, click Configure for whichever
client you use:

- **Claude Desktop / Claude Code / Cursor** — one-click; writes to the client's
  `mcpServers` config
- **Pi** — install [pi-mcporter](https://github.com/mavam/pi-mcporter), then
  `mcporter list` should show `carbonink` (discovered via `~/.claude.json`)

## Install

Drop the `carbonink-mcp/` directory into your agent's skills folder:

| Agent | Path |
|---|---|
| Claude Code | `~/.claude/skills/carbonink-mcp/SKILL.md` |
| Pi | `~/.pi/agent/skills/carbonink-mcp/SKILL.md` |
| Generic / shared | `~/.agents/skills/carbonink-mcp/SKILL.md` |

The shared `~/.agents/skills/` location is read by multiple hosts via symlink
(this is the standard share-via-`~/.agents/` pattern). You only need one
physical copy if you symlink:

```bash
# Single-source install
mkdir -p ~/.agents/skills/carbonink-mcp
cp SKILL.md ~/.agents/skills/carbonink-mcp/

# Symlinks (matches the existing skill convention on your machine)
ln -sf ../../.agents/skills/carbonink-mcp ~/.claude/skills/carbonink-mcp
ln -sf ../../../.agents/skills/carbonink-mcp ~/.pi/agent/skills/carbonink-mcp
```

Restart your agent host (or just start a new session) for the skill to be
discovered.

## Verify it loaded

In a fresh agent session:

```
list my carbonink questionnaires
```

The agent should call `list_questionnaires` directly (Pi: via
`mcporter call`). If it grep's the codebase instead, the skill didn't load —
check the install path matches the table above.

## Status

Bundled with CarbonInk as a v1.x convenience. The Settings → MCP page may
later grow an "Install agent skill" button that does the file copy + symlinks
above for you.
