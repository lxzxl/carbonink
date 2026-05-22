-- src/main/db/migrations/011_seed_emission_factors_v2.sql
-- Phase 1b: seed 20 additional EFs covering fuel (LPG, CNG, jet A), freight modes (road variants, rail, sea, air),
-- travel modes (air economy/business, rail China variants, taxi), and purchase categories (materials + services in CNY).
--
-- Together with the 12 EFs from migration 008, provides 32 total EFs covering:
--   - Scope 1: fuels (LPG, CNG, jet A)
--   - Scope 3: freight transport (road generic + 3 truck types, rail, sea, air)
--   - Scope 3: business travel (air economy + business, rail China, taxi)
--   - Scope 3: purchased goods (materials like steel, paper)
--   - Scope 3: purchased services (generic office supplies and consulting in CNY)
--
-- Note: factor_code is used for FTS matching, but the PRIMARY KEY is
-- (factor_code, year, source, geography, dataset_version). These 20 rows
-- use unique combinations of those 5 columns.

INSERT INTO emission_factor (
  factor_code, year, source, geography, dataset_version,
  scope, category, ghg_protocol_path, input_unit,
  co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
  gwp_basis, name_zh, name_en, citation_url
) VALUES
-- Fuel: Scope 1 (LPG, CNG, jet A) — using IPCC_AR6 source with variant dataset_versions
('fuel.lpg.combustion', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v2',
 1, 'fuel.combustion', 'scope1.stationary_combustion', 'kg',
 2.983, NULL, NULL, 'AR6', '液化石油气燃烧', 'LPG combustion', 'https://www.ipcc.ch/report/ar6/'),

('fuel.cng.combustion', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v2',
 1, 'fuel.combustion', 'scope1.stationary_combustion', 'm3',
 2.020, NULL, NULL, 'AR6', '压缩天然气燃烧', 'CNG combustion', 'https://www.ipcc.ch/report/ar6/'),

('fuel.jet_a.combustion', 2024, 'IPCC_AR6', 'GLOBAL', '2024.v2',
 1, 'fuel.combustion', 'scope1.mobile_combustion', 'L',
 2.550, NULL, NULL, 'AR6', '喷气燃料A燃烧', 'Jet fuel A combustion', 'https://www.ipcc.ch/report/ar6/'),

-- Freight: Scope 3 (road generic + 3 truck variants, rail, sea, air)
('freight.road.generic', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.road', 'scope3.cat4_upstream_transportation', 'tkm',
 0.135, NULL, NULL, 'AR6', '公路货运一般', 'Generic road freight', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('freight.road.heavy_diesel_truck', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.road.heavy_diesel_truck', 'scope3.cat4_upstream_transportation', 'tkm',
 0.078, NULL, NULL, 'AR6', '重型柴油货车', 'Heavy diesel truck freight', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('freight.road.medium_diesel_truck', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.road.medium_diesel_truck', 'scope3.cat4_upstream_transportation', 'tkm',
 0.135, NULL, NULL, 'AR6', '中型柴油货车', 'Medium diesel truck freight', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('freight.road.light_van', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.road.light_van', 'scope3.cat4_upstream_transportation', 'tkm',
 0.485, NULL, NULL, 'AR6', '轻型厢式货车', 'Light van freight', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('freight.rail.generic', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.rail', 'scope3.cat4_upstream_transportation', 'tkm',
 0.029, NULL, NULL, 'AR6', '铁路货运一般', 'Generic rail freight', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('freight.sea.containerized', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.sea', 'scope3.cat4_upstream_transportation', 'tkm',
 0.012, NULL, NULL, 'AR6', '海运集装箱', 'Containerized sea freight', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('freight.air.shorthaul', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'freight.air', 'scope3.cat4_upstream_transportation', 'tkm',
 1.130, NULL, NULL, 'AR6', '空运短程', 'Air freight short-haul', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

-- Travel: Scope 3 (air economy short/long-haul, air business long-haul, rail China variants, taxi)
('travel.air.economy.shorthaul', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'travel.air.economy.shorthaul', 'scope3.cat6_business_travel', 'passenger_km',
 0.158, NULL, NULL, 'AR6', '航空经济舱短程', 'Air travel economy short-haul', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('travel.air.economy.longhaul', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'travel.air.economy.longhaul', 'scope3.cat6_business_travel', 'passenger_km',
 0.149, NULL, NULL, 'AR6', '航空经济舱长程', 'Air travel economy long-haul', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('travel.air.business.longhaul', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'travel.air.business.longhaul', 'scope3.cat6_business_travel', 'passenger_km',
 0.434, NULL, NULL, 'AR6', '航空商务舱长程', 'Air travel business long-haul', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

('travel.rail.highspeed_china', 2024, 'MEE_China', 'CN', '2024.v2',
 3, 'travel.rail.highspeed_china', 'scope3.cat6_business_travel', 'passenger_km',
 0.029, NULL, NULL, 'AR6', '中国高铁', 'China high-speed rail', 'https://www.mee.gov.cn/'),

('travel.rail.regular_china', 2024, 'MEE_China', 'CN', '2024.v2',
 3, 'travel.rail.regular_china', 'scope3.cat6_business_travel', 'passenger_km',
 0.033, NULL, NULL, 'AR6', '中国普速铁路', 'China regular rail', 'https://www.mee.gov.cn/'),

('travel.taxi.gasoline_vehicle', 2024, 'DEFRA', 'GLOBAL', '2024.annual',
 3, 'travel.taxi.gasoline_vehicle', 'scope3.cat6_business_travel', 'passenger_km',
 0.187, NULL, NULL, 'AR6', '汽油出租车', 'Taxi gasoline vehicle', 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting'),

-- Purchase: Scope 3 (materials: steel, paper; services: office supplies + consulting in CNY)
('purchase.material.steel_primary', 2024, 'EcoInvent', 'GLOBAL', '3.10',
 3, 'purchase.material.steel', 'scope3.cat1_purchased_goods', 'kg',
 2.300, NULL, NULL, 'AR6', '原生钢材', 'Primary steel material', 'https://www.ecoinvent.org/'),

('purchase.material.paper_office', 2024, 'EcoInvent', 'GLOBAL', '3.10',
 3, 'purchase.material.paper', 'scope3.cat1_purchased_goods', 'kg',
 1.200, NULL, NULL, 'AR6', '办公用纸', 'Office paper', 'https://www.ecoinvent.org/'),

('purchase.service.office_supplies_generic', 2024, 'MEE_China_IO', 'CN', '2024.annual',
 3, 'purchase.service.office_supplies', 'scope3.cat1_purchased_goods', 'CNY',
 0.0008, NULL, NULL, 'AR6', '一般办公用品', 'Generic office supplies', 'https://www.mee.gov.cn/'),

('purchase.service.consulting_generic', 2024, 'MEE_China_IO', 'CN', '2024.annual',
 3, 'purchase.service.consulting', 'scope3.cat1_purchased_goods', 'CNY',
 0.0006, NULL, NULL, 'AR6', '咨询服务', 'Consulting services', 'https://www.mee.gov.cn/');
