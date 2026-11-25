-- 025_agent_trace.sql
-- Persist structured agent execution traces on AI-generated questionnaire
-- answers so the review card can display the tool-call chain without putting
-- prompt/record content into audit_event.

ALTER TABLE answer ADD COLUMN agent_trace TEXT
  CHECK(agent_trace IS NULL OR json_valid(agent_trace));
