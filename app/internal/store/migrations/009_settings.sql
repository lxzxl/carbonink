-- src/main/db/migrations/009_settings.sql
-- Phase 1b: app-level key/value setting store.
--
-- Used by SettingsService to persist the provider config (JSON-serialized
-- ProviderConfig minus the API key). The API key itself stays in the OS
-- keychain via CredentialService — only references (apiKeyKeyref) leak into
-- this table.
--
-- Schema is a deliberately small KV table because Phase 1b only has one
-- setting key (`llm.provider`); future settings (theme, locale override,
-- onboarding state, …) can re-use the same shape rather than each growing
-- their own column on a wider table.

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
