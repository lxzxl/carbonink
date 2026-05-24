-- 0001_initial_schema.sql
-- Core tables for the CarbonInk licensing system.

CREATE TABLE customer (
  user_id            TEXT PRIMARY KEY,           -- 'usr_01H...' (ULID)
  email              TEXT NOT NULL UNIQUE,
  country            TEXT,                       -- ISO 3166-1 alpha-2, from IP at signup
  created_at         INTEGER NOT NULL,           -- unix seconds
  stripe_customer_id TEXT
);

CREATE TABLE license (
  license_id              TEXT PRIMARY KEY,       -- 'lic_01H...' (ULID)
  user_id                 TEXT NOT NULL REFERENCES customer(user_id),
  humanized_key           TEXT NOT NULL UNIQUE,   -- 'cik-XXXXX-XXXXX-XXXXX-XXXXX'
  plan                    TEXT NOT NULL,
  features                TEXT NOT NULL,           -- JSON array
  devices_max             INTEGER NOT NULL,
  issued_at               INTEGER NOT NULL,
  expires_at              INTEGER NOT NULL,
  grace_until             INTEGER NOT NULL,
  stripe_subscription_id  TEXT,
  revoked                 INTEGER NOT NULL DEFAULT 0,
  revoked_at              INTEGER,
  revoked_reason          TEXT
);

CREATE TABLE device (
  device_id       TEXT NOT NULL,
  license_id      TEXT NOT NULL REFERENCES license(license_id),
  first_seen_at   INTEGER NOT NULL,
  last_ping_at    INTEGER NOT NULL,
  app_version     TEXT,
  os              TEXT,
  PRIMARY KEY (device_id, license_id)
);

CREATE INDEX idx_license_user ON license(user_id);
CREATE INDEX idx_device_license ON device(license_id);
