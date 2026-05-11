import { runMigrations } from '@main/db/migrate';
import { CalculationService, GWP_AR6 } from '@main/services/calculation-service';
import { EfService } from '@main/services/ef-service';
import {
  DimensionMismatchError,
  UnitConversionService,
} from '@main/services/unit-conversion-service';
import type { EfCompositePk, PinnedEmissionFactor } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db: Database.Database;
let unitConv: UnitConversionService;
let ef: EfService;
let calc: CalculationService;

const FIXED_NOW = '2026-05-11T00:00:00.000Z';

const PK_CN_NATIONAL: EfCompositePk = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
};

const PK_GASOLINE: EfCompositePk = {
  factor_code: 'fuel.gasoline.combustion.global.2024',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.v1',
};

const PK_NATURAL_GAS: EfCompositePk = {
  factor_code: 'fuel.natural_gas.combustion.global.2024',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.v1',
};

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  unitConv = new UnitConversionService({ db });
  ef = new EfService({ db, now: () => FIXED_NOW });
  calc = new CalculationService({ unitConversion: unitConv });
});

afterEach(() => db.close());

describe('CalculationService.GWP_AR6 constants', () => {
  it('exports AR6 GWP100 values for CH4 and N2O', () => {
    expect(GWP_AR6.CH4).toBe(27.9);
    expect(GWP_AR6.N2O).toBe(273);
  });
});

describe('CalculationService.compute — electricity (kWh family)', () => {
  it('1000 kWh × CN national grid (0.5703) = 570.3 kg', () => {
    const pinned = ef.pin(PK_CN_NATIONAL);
    const out = calc.compute({ amount: 1000, unit: 'kWh', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(570.3, 4);
    expect(out.amount_in_ef_unit).toBe(1000);
  });

  it('1000 度 (alias) × CN national grid = 570.3 kg', () => {
    const pinned = ef.pin(PK_CN_NATIONAL);
    const out = calc.compute({ amount: 1000, unit: '度', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(570.3, 4);
    expect(out.amount_in_ef_unit).toBe(1000);
  });

  it('1 MWh × CN national grid = 570.3 kg (cross-unit same family)', () => {
    const pinned = ef.pin(PK_CN_NATIONAL);
    const out = calc.compute({ amount: 1, unit: 'MWh', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(570.3, 4);
    expect(out.amount_in_ef_unit).toBeCloseTo(1000, 6);
  });
});

describe('CalculationService.compute — gasoline (volume family)', () => {
  it('100 L gasoline × 2.296 = 229.6 kg', () => {
    const pinned = ef.pin(PK_GASOLINE);
    const out = calc.compute({ amount: 100, unit: 'L', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(229.6, 4);
    expect(out.amount_in_ef_unit).toBe(100);
  });

  it('100 升 (alias) × gasoline EF = 229.6 kg', () => {
    const pinned = ef.pin(PK_GASOLINE);
    const out = calc.compute({ amount: 100, unit: '升', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(229.6, 4);
  });

  it('73 kg gasoline via convertWithFuel (density 0.745 kg/L) → ~98 L → ~225 kg', () => {
    const pinned = ef.pin(PK_GASOLINE);
    const out = calc.compute({
      amount: 73,
      unit: 'kg',
      ef: pinned,
      fuelCode: 'gasoline',
    });
    // 73 kg / 0.745 = 97.987 L; 97.987 × 2.296 = 224.98 kg
    expect(out.amount_in_ef_unit).toBeCloseTo(97.987, 2);
    expect(out.co2e_kg).toBeCloseTo(224.98, 1);
  });

  it('throws when cross-family is requested without fuelCode', () => {
    const pinned = ef.pin(PK_GASOLINE); // input_unit = L (volume)
    expect(() => calc.compute({ amount: 73, unit: 'kg', ef: pinned })).toThrow(
      DimensionMismatchError,
    );
  });
});

describe('CalculationService.compute — natural gas (m3 family)', () => {
  it('100 m3 natural gas × 1.879 = 187.9 kg', () => {
    const pinned = ef.pin(PK_NATURAL_GAS);
    const out = calc.compute({ amount: 100, unit: 'm3', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(187.9, 4);
    expect(out.amount_in_ef_unit).toBe(100);
  });

  it('100 方 (alias) × natural gas EF = 187.9 kg', () => {
    const pinned = ef.pin(PK_NATURAL_GAS);
    const out = calc.compute({ amount: 100, unit: '方', ef: pinned });
    expect(out.co2e_kg).toBeCloseTo(187.9, 4);
  });
});

describe('CalculationService.compute — breakdown shape', () => {
  it('for Phase 1a EFs (ch4/n2o NULL) breakdown.ch4 and .n2o are 0', () => {
    const pinned = ef.pin(PK_GASOLINE);
    const out = calc.compute({ amount: 100, unit: 'L', ef: pinned });
    expect(out.breakdown.ch4_co2e_kg).toBe(0);
    expect(out.breakdown.n2o_co2e_kg).toBe(0);
    // direct already includes total AR6 CO2e for these seed rows.
    expect(out.breakdown.direct_co2_kg).toBeCloseTo(229.6, 4);
    // Sum invariant.
    expect(out.co2e_kg).toBeCloseTo(
      out.breakdown.direct_co2_kg + out.breakdown.ch4_co2e_kg + out.breakdown.n2o_co2e_kg,
      6,
    );
  });

  it('returns amount_in_ef_unit matching unit conversion', () => {
    const pinned = ef.pin(PK_CN_NATIONAL);
    // 0.5 MWh → 500 kWh
    const out = calc.compute({ amount: 0.5, unit: 'MWh', ef: pinned });
    expect(out.amount_in_ef_unit).toBeCloseTo(500, 6);
    expect(out.co2e_kg).toBeCloseTo(500 * 0.5703, 4);
  });
});

describe('CalculationService.compute — decomposed EF path (Phase 1c+ guard)', () => {
  // Construct a synthetic pinned EF with non-null ch4 / n2o components.
  // This shape won't come from the Phase 1a seed; we build it inline to
  // guarantee the additive formula keeps working when Phase 1c+ introduces
  // decomposed CO2 / CH4 / N2O EFs.
  const SYNTHETIC_EF: PinnedEmissionFactor = {
    factor_code: 'synthetic.decomposed.test',
    year: 2024,
    source: 'TEST',
    geography: 'GLOBAL',
    dataset_version: 'test.v1',
    scope: 1,
    category: 'fuel.stationary',
    ghg_protocol_path: 'scope1.stationary_combustion',
    input_unit: 'L',
    co2e_kg_per_unit: 2.0, // direct CO2 component only
    ch4_kg_per_unit: 0.0001, // 0.0001 kg CH4 per L
    n2o_kg_per_unit: 0.00002, // 0.00002 kg N2O per L
    hfc_kg_per_unit: null,
    pfc_kg_per_unit: null,
    sf6_kg_per_unit: null,
    nf3_kg_per_unit: null,
    gwp_basis: 'AR6',
    name_zh: null,
    name_en: null,
    description_zh: null,
    description_en: null,
    citation_url: null,
    pinned_at: FIXED_NOW,
    pinned_from: 'app.sqlite',
  };

  it('adds CH4·GWP_CH4 and N2O·GWP_N2O when those columns are populated', () => {
    const out = calc.compute({ amount: 100, unit: 'L', ef: SYNTHETIC_EF });

    const expected_direct = 100 * 2.0; // 200
    const expected_ch4 = 100 * 0.0001 * 27.9; // 0.279
    const expected_n2o = 100 * 0.00002 * 273; // 0.546
    const expected_total = expected_direct + expected_ch4 + expected_n2o; // 200.825

    expect(out.breakdown.direct_co2_kg).toBeCloseTo(expected_direct, 6);
    expect(out.breakdown.ch4_co2e_kg).toBeCloseTo(expected_ch4, 6);
    expect(out.breakdown.n2o_co2e_kg).toBeCloseTo(expected_n2o, 6);
    expect(out.co2e_kg).toBeCloseTo(expected_total, 6);
  });

  it('treats null CH4 as 0 contribution but uses populated N2O', () => {
    const ef_n2o_only: PinnedEmissionFactor = {
      ...SYNTHETIC_EF,
      ch4_kg_per_unit: null,
      n2o_kg_per_unit: 0.00002,
    };
    const out = calc.compute({ amount: 100, unit: 'L', ef: ef_n2o_only });
    expect(out.breakdown.ch4_co2e_kg).toBe(0);
    expect(out.breakdown.n2o_co2e_kg).toBeCloseTo(100 * 0.00002 * 273, 6);
    expect(out.co2e_kg).toBeCloseTo(200 + 0.546, 6);
  });
});
