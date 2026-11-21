-- 021_activity_fuel_code.sql
-- Persist the fuel binding used to compute an activity row's CO2e.
--
-- `fuel_code` is an input to CalculationService.compute: it is what lets a
-- volume amount be applied to a per-mass factor (100 L of diesel -> 83.2 kg via
-- density). ActivityDataService.create accepted it, used it, and then dropped
-- it -- so a cross-family row could not be recomputed from the ledger, and an
-- auditor reading the row saw litres multiplied by a per-kg coefficient with no
-- explanation of how the two met.
--
-- Storing it closes that gap and makes the readiness check N1 exact: a
-- cross-family row with a fuel_code is correct, one without is not.
--
-- Nullable by design -- same-family rows need no binding, and that is the
-- overwhelming majority.

ALTER TABLE activity_data ADD COLUMN fuel_code TEXT
  REFERENCES fuel_property(fuel_code);
