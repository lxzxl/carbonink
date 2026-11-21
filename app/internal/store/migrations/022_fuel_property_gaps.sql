-- 022_fuel_property_gaps.sql
-- Fill the two fuel_property holes that block real disclosure formats.
--
-- Both were found while building the demo packs in src/main/data/demo/ from
-- published sustainability reports. Sustainability reports denominate fuel in
-- ENERGY (MWh, GJ, tce), not in the volume/mass a combustion factor expects, so
-- every one of those imports lands on UnitConversionService.convertWithFuel's
-- energy -> volume path. That path derives mass first
-- (MJ / lower_heating_value_MJ_per_kg) and then volume
-- (kg / density_kg_per_L), so BOTH columns have to be present or the
-- conversion throws.
--
--   1. natural_gas had lower_heating_value_MJ_per_m3 (35.9) and
--      density_kg_per_m3 (0.717) but neither per-kg nor per-L value, so
--      "6,404,702 MWh of natural gas" failed with
--      "Cannot derive volume from MWh via fuel natural_gas". MWh is the
--      standard disclosure unit for gas, so this blocked every pack.
--
--   2. jet_a did not exist at all, so aviation kerosene could not reach the
--      litres that fuel.jet_a.combustion expects — the single largest line in
--      an airline or express-logistics inventory.
--
-- The natural_gas values are DERIVED FROM THE ROW'S OWN m3 FIGURES rather than
-- quoted independently, so all four conversion paths agree:
--   lower_heating_value_MJ_per_kg = 35.9 / 0.717 = 50.0697 MJ/kg
--   density_kg_per_L              = 0.717 / 1000 = 0.000717 kg/L
-- Quoting the IPCC 48.0 MJ/kg default here instead would make m3 -> MJ and
-- m3 -> kg -> MJ return different answers for the same input, which is a worse
-- failure than the one being fixed. 50.0697 MJ/kg is also physically sound for
-- methane-dominant pipeline gas (pure CH4 is 50.0 MJ/kg).
--
-- Six significant figures, unlike the 3-4 used elsewhere in this table: the
-- other rows quote independently-measured properties where 3 figures is the
-- real precision, whereas this one exists to reconcile two stored constants
-- and its trailing digits are doing load-bearing work. At 50.07 the mass and
-- volumetric paths drift ~5e-6 apart, which is invisible per row but shows up
-- once a test asserts the two agree.
--
-- Populating density_kg_per_L for a gas reads oddly but is correct: it is the
-- same standard-conditions density expressed per litre, and it is the column
-- the mass -> volume branch actually reads. The branch has no
-- density_kg_per_m3 fallback, unlike its volume -> mass counterpart — worth
-- straightening out separately, but not while a data fix will do.

UPDATE fuel_property
   SET lower_heating_value_MJ_per_kg = 50.0697,
       density_kg_per_L              = 0.000717,
       notes = '管道燃气，标况；per-kg/per-L 值由 35.9 MJ/m3 与 0.717 kg/m3 换算得出，保证各换算路径一致'
 WHERE fuel_code = 'natural_gas';

-- Jet A / Jet A-1. NCV is the IPCC 2006 Guidelines Vol.2 Table 1.2 default for
-- Jet Kerosene (44.1 TJ/Gg); density is the ASTM D1655 nominal at 15 degrees C
-- (spec range 0.775-0.840 kg/L). Together they give 35.28 MJ/L, which puts the
-- seeded fuel.jet_a.combustion factor (2.550 kgCO2e/L) at 72.3 kgCO2e/GJ —
-- within a couple of percent of the IPCC 71,500 kgCO2/TJ default, so the
-- factor and the fuel property are mutually consistent.
INSERT INTO fuel_property (
  fuel_code, density_kg_per_L, density_kg_per_m3,
  lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3,
  source, notes
) VALUES
('jet_a', 0.800, NULL, 44.1, NULL, 'IPCC 2006 GL Vol.2 Table 1.2 + ASTM D1655', '航空煤油 Jet A/A-1，15°C 标称密度');
