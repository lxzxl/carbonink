-- spec §1: 单机一个 organization；N 个 site；N 个 reporting_period

CREATE TABLE organization (
  id            TEXT PRIMARY KEY,
  -- spec §1: 单机一个 organization。用 singleton_key 列 + UNIQUE + CHECK 在 DB 层硬约束。
  -- 任何 INSERT 都会写 singleton_key = 1；第二次 INSERT 必失败（UNIQUE 冲突）。
  singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
  name_zh       TEXT,
  name_en       TEXT,
  industry      TEXT,
  country_code  TEXT NOT NULL,
  boundary_kind TEXT NOT NULL CHECK(boundary_kind IN ('equity_share', 'operational_control')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE site (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name_zh       TEXT,
  name_en       TEXT,
  address       TEXT,
  country_code  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_site_org ON site(organization_id);

CREATE TABLE reporting_period (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  year          INTEGER NOT NULL,
  granularity   TEXT NOT NULL CHECK(granularity IN ('annual', 'quarterly', 'monthly')),
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  UNIQUE (organization_id, year, granularity)
);
CREATE INDEX idx_period_org_year ON reporting_period(organization_id, year);
