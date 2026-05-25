-- Migration 0002 — license_request table.
--
-- Captures expressions of interest from carbonink.xyz/pricing (and
-- adjacent pages) while we're in pre-paid early-access mode. The
-- marketing "申请早期试用 / Request early access" CTA posts here.
--
-- Rows are NOT auth'd or deduped at the DB layer:
--   * No FK to `customer` — early-access users haven't necessarily
--     signed up via magic-link yet.
--   * Duplicates allowed — re-submitting the same email tells us
--     "this person is really keen", which is a useful signal.
--     Email-notification dedup happens at the KV rate-limit layer,
--     not here.
--
-- `source` is a short tag for funnel attribution (pricing-page vs.
-- account-page vs. home). `lang` is captured so the manual
-- follow-up email can match locale. `user_agent` is kept for spam
-- detection — bot floods come from identifiable UAs.

CREATE TABLE IF NOT EXISTS license_request (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  source      TEXT,
  lang        TEXT,
  user_agent  TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_request_email      ON license_request(email);
CREATE INDEX IF NOT EXISTS idx_license_request_created_at ON license_request(created_at DESC);
