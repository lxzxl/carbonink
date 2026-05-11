-- src/main/db/migrations/008_seed_emission_factors.sql
-- Phase 1a: seed 12 EFs covering Scope 1+2 (+ 2 Scope 3 placeholders for service testing).
-- All AR6 GWP100. dataset_version follows source's annual cadence.
--
-- Geography codes used in this seed (will be enforced in Phase 1c+):
--   GLOBAL              : factor applies globally (typically IPCC default factors)
--   CN, US, EU, etc.    : ISO-3166-1 alpha-2 country code (uppercase)
--   CN-North/East/South : MEE-defined grid regional groupings (not ISO subdivisions;
--                         ISO-3166-2 codes like CN-11 are sub-provincial)
--
-- Note on CH4/N2O columns: all rows in this seed have ch4_kg_per_unit / n2o_kg_per_unit
-- set to NULL. The co2e_kg_per_unit field already includes AR6 GWP-weighted CH4/N2O
-- contributions per the publishing source (IPCC AR6 Vol 2 for fuels; MEE/EPA grid
-- factors for electricity, which are CO2-only by methodology). The CalculationService
-- formula adds (amount × ch4 × GWP_CH4 + amount × n2o × GWP_N2O) on top of the direct
-- co2e term — populating ch4/n2o here would double-count. Phase 1c+ EFs that store
-- decomposed CO2/CH4/N2O separately can populate these columns; the calc service
-- will then pick them up correctly.

INSERT INTO emission_factor (
  factor_code, year, source, geography, dataset_version,
  scope, category, ghg_protocol_path, input_unit,
  co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
  gwp_basis, name_zh, name_en, citation_url
) VALUES
('electricity.grid.cn.national.2024', 2024, 'MEE_China', 'CN', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.5703, NULL, NULL, 'AR6', '中国国家电网平均', 'China national grid average', 'https://www.mee.gov.cn/'),
('electricity.grid.cn.north.2024', 2024, 'MEE_China', 'CN-North', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.7321, NULL, NULL, 'AR6', '中国华北电网', 'China North China grid', 'https://www.mee.gov.cn/'),
('electricity.grid.cn.east.2024', 2024, 'MEE_China', 'CN-East', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.5586, NULL, NULL, 'AR6', '中国华东电网', 'China East China grid', 'https://www.mee.gov.cn/'),
('electricity.grid.cn.south.2024', 2024, 'MEE_China', 'CN-South', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.4276, NULL, NULL, 'AR6', '中国南方电网', 'China Southern grid', 'https://www.mee.gov.cn/'),
('electricity.grid.us.average.2024', 2024, 'EPA_eGRID', 'US', '2024.annual', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.3673, NULL, NULL, 'AR6', '美国电网平均', 'US grid average', 'https://www.epa.gov/egrid'),
-- fuel rows: ch4/n2o NULL; co2e total includes AR6 CH4/N2O contributions per IPCC AR6 Vol 2.
('fuel.gasoline.combustion.global.2024', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v1', 1, 'fuel.mobile', 'scope1.mobile_combustion', 'L',
 2.296, NULL, NULL, 'AR6', '汽油燃烧', 'Gasoline combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.diesel.combustion.global.2024', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v1', 1, 'fuel.mobile', 'scope1.mobile_combustion', 'L',
 2.683, NULL, NULL, 'AR6', '柴油燃烧', 'Diesel combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.natural_gas.combustion.global.2024', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v1', 1, 'fuel.stationary', 'scope1.stationary_combustion', 'm3',
 1.879, NULL, NULL, 'AR6', '天然气燃烧（管道）', 'Natural gas combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.lpg.combustion.global.2024', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v1', 1, 'fuel.stationary', 'scope1.stationary_combustion', 'L',
 1.612, NULL, NULL, 'AR6', '液化石油气燃烧', 'LPG combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.coal_anthracite.combustion.cn.2024', 2024, 'IPCC_AR6_CN', 'CN', '2024.v1', 1, 'fuel.stationary', 'scope1.stationary_combustion', 'kg',
 2.494, NULL, NULL, 'AR6', '无烟煤燃烧（中国）', 'Anthracite coal combustion (China)', 'https://www.ipcc.ch/report/ar6/'),
('freight.truck_diesel.china.2024', 2024, 'GLEC_CN', 'CN', '2024.v1', 3, 'upstream_transport', 'scope3.cat4_upstream_transportation', 'tkm',
 0.0962, NULL, NULL, 'AR6', '柴油货车货运（中国）', 'Diesel truck freight (China)', 'https://www.smartfreightcentre.org/'),
('material.steel.global.average.2024', 2024, 'WorldSteel', 'GLOBAL', '2024.annual', 3, 'purchased_goods', 'scope3.cat1_purchased_goods', 'kg',
 1.97, NULL, NULL, 'AR6', '钢材全球平均', 'Steel global average', 'https://worldsteel.org/');
