-- Phase 1a: seed unit_definition + unit_alias + fuel_property reference data.
-- Replaces future ef_library.sqlite RO bundle; that bundle is Phase 1c+ work.

-- ── reference tables (Phase 1a lives in app.sqlite; Phase 1c+ moves to ef_library.sqlite RO) ──
-- Schema mirrors §3 of docs/specs/2026-05-08-carbonbook-design.md.
CREATE TABLE IF NOT EXISTS unit_definition (
  unit              TEXT PRIMARY KEY,
  family            TEXT NOT NULL,
  multiply_of_ratio REAL NOT NULL,
  divide_of_ratio   REAL NOT NULL,
  display_order     INTEGER NOT NULL DEFAULT 100,
  display_name_zh   TEXT,
  display_name_en   TEXT
);
CREATE INDEX IF NOT EXISTS idx_unit_family ON unit_definition(family, display_order);

CREATE TABLE IF NOT EXISTS unit_alias (
  alias          TEXT PRIMARY KEY,
  canonical_unit TEXT NOT NULL REFERENCES unit_definition(unit),
  language       TEXT NOT NULL,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_unit_alias_canonical ON unit_alias(canonical_unit);

CREATE TABLE IF NOT EXISTS fuel_property (
  fuel_code                     TEXT PRIMARY KEY,
  density_kg_per_L              REAL,
  density_kg_per_m3             REAL,
  lower_heating_value_MJ_per_kg REAL,
  lower_heating_value_MJ_per_m3 REAL,
  source                        TEXT NOT NULL,
  notes                         TEXT
);

-- ── unit_definition: ratio is to family's canonical unit ──
-- Canonical units: energy=kWh, volume=L, mass=kg, distance=km, currency=CNY
-- multiply_of_ratio: amount_in_canonical = amount × multiply / divide

INSERT INTO unit_definition (unit, family, multiply_of_ratio, divide_of_ratio, display_order, display_name_zh, display_name_en) VALUES
-- energy (canonical: kWh)
('kWh', 'energy', 1, 1, 10, '千瓦时', 'kilowatt-hour'),
('MWh', 'energy', 1000, 1, 20, '兆瓦时', 'megawatt-hour'),
('GWh', 'energy', 1000000, 1, 30, '吉瓦时', 'gigawatt-hour'),
('MJ',  'energy', 1, 3.6, 40, '兆焦', 'megajoule'),
('GJ',  'energy', 1000, 3.6, 50, '吉焦', 'gigajoule'),
('TJ',  'energy', 1000000, 3.6, 60, '太焦', 'terajoule'),
('BTU', 'energy', 1, 3412.14, 70, '英热单位', 'British thermal unit'),
('therm', 'energy', 29.3001, 1, 80, '色姆', 'therm'),
-- volume (canonical: L)
('L', 'volume', 1, 1, 10, '升', 'liter'),
('mL', 'volume', 1, 1000, 20, '毫升', 'milliliter'),
('m3', 'volume', 1000, 1, 30, '立方米', 'cubic meter'),
('cm3', 'volume', 1, 1000, 40, '立方厘米', 'cubic centimeter'),
('gallon_us', 'volume', 3.78541, 1, 50, '美加仑', 'US gallon'),
('gallon_uk', 'volume', 4.54609, 1, 60, '英加仑', 'UK gallon'),
('barrel_oil', 'volume', 158.987, 1, 70, '桶（油）', 'oil barrel'),
-- mass (canonical: kg)
('kg', 'mass', 1, 1, 10, '公斤', 'kilogram'),
('g',  'mass', 1, 1000, 20, '克', 'gram'),
('mg', 'mass', 1, 1000000, 30, '毫克', 'milligram'),
('t',  'mass', 1000, 1, 40, '吨', 'metric tonne'),
('Mt', 'mass', 1000000000, 1, 50, '百万吨', 'megatonne'),
('lb', 'mass', 0.453592, 1, 60, '磅', 'pound'),
('oz', 'mass', 0.0283495, 1, 70, '盎司', 'ounce'),
('short_ton', 'mass', 907.185, 1, 80, '短吨', 'short ton'),
('long_ton', 'mass', 1016.05, 1, 90, '长吨', 'long ton'),
-- distance (canonical: km)
('km', 'distance', 1, 1, 10, '公里', 'kilometer'),
('m',  'distance', 1, 1000, 20, '米', 'meter'),
('cm', 'distance', 1, 100000, 30, '厘米', 'centimeter'),
('mile', 'distance', 1.60934, 1, 40, '英里', 'mile'),
('nautical_mile', 'distance', 1.852, 1, 50, '海里', 'nautical mile'),
('ft', 'distance', 1, 3280.84, 60, '英尺', 'foot'),
-- currency (canonical: CNY) — for spend-based EF, exact rate set per-period elsewhere
('CNY', 'currency', 1, 1, 10, '人民币', 'Chinese yuan'),
('USD', 'currency', 7.2, 1, 20, '美元', 'US dollar'),
('EUR', 'currency', 7.8, 1, 30, '欧元', 'euro'),
('GBP', 'currency', 9.1, 1, 40, '英镑', 'British pound'),
('JPY', 'currency', 1, 21, 50, '日元', 'Japanese yen'),
('HKD', 'currency', 0.92, 1, 60, '港币', 'Hong Kong dollar'),
-- composite: tonne-kilometer (货运专用，不可被自动 convert，单独 family)
('tkm', 'mass_distance', 1, 1, 10, '吨公里', 'tonne-kilometer'),
('passenger_km', 'passenger_distance', 1, 1, 10, '人公里', 'passenger-kilometer'),
('km_passenger', 'passenger_distance', 1, 1, 20, '公里·人', 'kilometer-passenger');

-- ── unit_alias: 中文 + 大小写 + 单位写法变体 ──
INSERT INTO unit_alias (alias, canonical_unit, language, notes) VALUES
-- energy
('kwh', 'kWh', 'en', 'lowercase'),
('KWH', 'kWh', 'en', 'uppercase'),
('度', 'kWh', 'zh', '电力'),
('度电', 'kWh', 'zh', '电力'),
('千瓦时', 'kWh', 'zh', NULL),
('mwh', 'MWh', 'en', NULL),
('兆瓦时', 'MWh', 'zh', NULL),
('万度', 'MWh', 'zh', '10000 kWh ≈ 10 MWh，approx; 注：实际是 10MWh，此 alias 提示用户复核'),
('mj', 'MJ', 'en', NULL),
('兆焦', 'MJ', 'zh', NULL),
('gj', 'GJ', 'en', NULL),
('吉焦', 'GJ', 'zh', NULL),
('btu', 'BTU', 'en', NULL),
-- volume
('l', 'L', 'en', NULL),
('ltr', 'L', 'en', NULL),
('升', 'L', 'zh', NULL),
('公升', 'L', 'zh', NULL),
('m³', 'm3', 'en', NULL),
('立方米', 'm3', 'zh', NULL),
('方', 'm3', 'zh', '天然气计量常用'),
('立方', 'm3', 'zh', NULL),
('ml', 'mL', 'en', NULL),
('毫升', 'mL', 'zh', NULL),
('gallon', 'gallon_us', 'en', '默认 US；如英标请用 gallon_uk'),
('加仑', 'gallon_us', 'zh', '默认 US'),
('美加仑', 'gallon_us', 'zh', NULL),
('英加仑', 'gallon_uk', 'zh', NULL),
-- mass
('Kg', 'kg', 'en', NULL),
('KG', 'kg', 'en', NULL),
('公斤', 'kg', 'zh', NULL),
('千克', 'kg', 'zh', NULL),
('斤', 'kg', 'zh', '注：实际 0.5 kg，此 alias 是常见误用提示'),
('g', 'g', 'en', NULL),
('gram', 'g', 'en', NULL),
('克', 'g', 'zh', NULL),
('t', 't', 'en', NULL),
('ton', 't', 'en', NULL),
('tonne', 't', 'en', 'metric'),
('吨', 't', 'zh', '公制'),
('公吨', 't', 'zh', '明确公制'),
('lb', 'lb', 'en', NULL),
('pound', 'lb', 'en', NULL),
('磅', 'lb', 'zh', NULL),
('oz', 'oz', 'en', NULL),
('盎司', 'oz', 'zh', NULL),
-- distance
('km', 'km', 'en', NULL),
('Km', 'km', 'en', NULL),
('公里', 'km', 'zh', NULL),
('千米', 'km', 'zh', NULL),
('m', 'm', 'en', 'meter'),
('米', 'm', 'zh', NULL),
('mile', 'mile', 'en', NULL),
('mi', 'mile', 'en', NULL),
('英里', 'mile', 'zh', NULL),
-- currency
('cny', 'CNY', 'en', NULL),
('rmb', 'CNY', 'en', NULL),
('元', 'CNY', 'zh', NULL),
('人民币', 'CNY', 'zh', NULL),
('块', 'CNY', 'zh', NULL),
('usd', 'USD', 'en', NULL),
('$', 'USD', 'en', NULL),
('美元', 'USD', 'zh', NULL),
('美刀', 'USD', 'zh', NULL),
('eur', 'EUR', 'en', NULL),
('€', 'EUR', 'en', NULL),
('欧元', 'EUR', 'zh', NULL),
('gbp', 'GBP', 'en', NULL),
('£', 'GBP', 'en', NULL),
('英镑', 'GBP', 'zh', NULL),
('jpy', 'JPY', 'en', NULL),
('¥', 'JPY', 'en', NULL),
('日元', 'JPY', 'zh', NULL),
('hkd', 'HKD', 'en', NULL),
('港币', 'HKD', 'zh', NULL),
('港元', 'HKD', 'zh', NULL),
-- composite
('tkm', 'tkm', 'en', NULL),
('吨公里', 'tkm', 'zh', NULL),
('吨千米', 'tkm', 'zh', NULL),
('passenger_km', 'passenger_km', 'en', NULL),
('人公里', 'passenger_km', 'zh', NULL),
('客公里', 'passenger_km', 'zh', NULL);

-- ── fuel_property: 燃料密度 + 低位热值 ──
-- source: IPCC AR6 Vol 2 / 中国电力企业联合会
INSERT INTO fuel_property (
  fuel_code, density_kg_per_L, density_kg_per_m3,
  lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3,
  source, notes
) VALUES
('gasoline',         0.745, NULL, 44.3,  NULL, 'IPCC AR6 + GB/T 17930',  '93#/95# 平均'),
('diesel',           0.835, NULL, 43.0,  NULL, 'IPCC AR6 + GB/T 19147',  '0# 国六'),
('natural_gas',      NULL,  0.717, NULL, 35.9, 'IPCC AR6 + GB 17820',    '管道燃气，标况'),
('lpg',              0.540, NULL, 47.3,  NULL, 'IPCC AR6 + GB 11174',    '丙烷+丁烷混合，液相'),
('coal_anthracite',  NULL,  NULL,  29.3, NULL, 'IPCC AR6',               '中国无烟煤');
