-- spec §3: emission_factor (UNION readonly RO + user-uploaded) + pinned_emission_factor (在 app.sqlite, FK 目标)

CREATE TABLE emission_factor (
  factor_code      TEXT NOT NULL,
  year             INTEGER NOT NULL,
  source           TEXT NOT NULL,
  geography        TEXT NOT NULL,
  dataset_version  TEXT NOT NULL,

  scope            INTEGER NOT NULL CHECK(scope IN (1, 2, 3)),
  category         TEXT,
  ghg_protocol_path TEXT,
  input_unit       TEXT NOT NULL,
  co2e_kg_per_unit REAL NOT NULL,
  ch4_kg_per_unit  REAL,
  n2o_kg_per_unit  REAL,
  hfc_kg_per_unit  REAL,
  pfc_kg_per_unit  REAL,
  sf6_kg_per_unit  REAL,
  nf3_kg_per_unit  REAL,
  gwp_basis        TEXT NOT NULL CHECK(gwp_basis IN ('AR5', 'AR6')),
  name_zh          TEXT,
  name_en          TEXT,
  description_zh   TEXT,
  description_en   TEXT,
  notes            TEXT,
  citation_url     TEXT,

  PRIMARY KEY (factor_code, year, source, geography, dataset_version)
);
CREATE INDEX idx_ef_lookup ON emission_factor(factor_code, year, geography);
CREATE INDEX idx_ef_scope_cat ON emission_factor(scope, category);

CREATE TABLE pinned_emission_factor (
  factor_code      TEXT NOT NULL,
  year             INTEGER NOT NULL,
  source           TEXT NOT NULL,
  geography        TEXT NOT NULL,
  dataset_version  TEXT NOT NULL,

  scope            INTEGER NOT NULL CHECK(scope IN (1, 2, 3)),
  category         TEXT,
  ghg_protocol_path TEXT,
  input_unit       TEXT NOT NULL,
  co2e_kg_per_unit REAL NOT NULL,
  ch4_kg_per_unit  REAL,
  n2o_kg_per_unit  REAL,
  hfc_kg_per_unit  REAL,
  pfc_kg_per_unit  REAL,
  sf6_kg_per_unit  REAL,
  nf3_kg_per_unit  REAL,
  gwp_basis        TEXT NOT NULL CHECK(gwp_basis IN ('AR5', 'AR6')),
  name_zh          TEXT,
  name_en          TEXT,
  description_zh   TEXT,
  description_en   TEXT,
  citation_url     TEXT,

  pinned_at        TEXT NOT NULL,
  pinned_from      TEXT NOT NULL,

  PRIMARY KEY (factor_code, year, source, geography, dataset_version)
);
