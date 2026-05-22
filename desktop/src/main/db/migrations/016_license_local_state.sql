-- 016_license_local_state.sql
-- Single-row local cache of license state metadata. The active JWT itself
-- lives in OS Keychain (safeStorage); this table holds the support data the
-- Keychain can't: a stable device_id, the timestamp of the last successful
-- cloud /verify, a counter of consecutive offline failures (drives the
-- "expired if > 30 days offline" rule from design spec §10), and the last
-- computed state + timestamp (purely for diagnostics / UI cold-start hint).
--
-- Single-row pattern: PK = literal 1. INSERT OR IGNORE on app boot
-- guarantees a row exists; subsequent code only ever UPDATEs.

CREATE TABLE license_local_state (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  device_id                   TEXT    NOT NULL,
  last_verified_at            TEXT,
  consecutive_offline_days    INTEGER NOT NULL DEFAULT 0,
  last_known_state            TEXT    NOT NULL DEFAULT 'unverified'
                                CHECK (last_known_state IN ('unverified','active','grace','expired','revoked')),
  last_known_state_at         TEXT,
  created_at                  TEXT    NOT NULL,
  updated_at                  TEXT    NOT NULL
);

-- Seed the singleton row with a placeholder device_id. The Service layer
-- replaces it on first read with a real ULID — binding device identity
-- to first launch (not migration time) so a developer rerunning
-- migrations on a fresh DB still gets a fresh identity.
INSERT INTO license_local_state (id, device_id, created_at, updated_at)
VALUES (
  1,
  'pending-first-launch',
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z'
);
