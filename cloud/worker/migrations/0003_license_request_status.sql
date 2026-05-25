-- Migration 0003 — license_request gets status/processed columns.
--
-- The base table (0002) was append-only: every form submit became a
-- new row. That was fine for "track who's asking" but useless for
-- the admin queue, which needs to distinguish pending vs. handled.
--
-- We bolt on status without rewriting history. New columns:
--   status           — 'pending' (default) | 'issued' | 'dismissed'
--   issued_license_id — FK soft-link to license.license_id when status='issued'
--   processed_at     — unix seconds when admin clicked issue/dismiss
--   processed_by     — admin email that processed the request
--
-- Existing rows default to 'pending' so the migration is a no-op for
-- live data — admin sees the full backlog on first load.

ALTER TABLE license_request ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE license_request ADD COLUMN issued_license_id TEXT;
ALTER TABLE license_request ADD COLUMN processed_at INTEGER;
ALTER TABLE license_request ADD COLUMN processed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_license_request_status ON license_request(status);
