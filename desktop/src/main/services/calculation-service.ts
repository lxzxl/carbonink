import type { PinnedEmissionFactor } from '@shared/types.js';
import type { UnitConversionService } from './unit-conversion-service.js';

/**
 * GWP100 (100-year Global Warming Potential) values from IPCC AR6
 * (Working Group I, Chapter 7, Table 7.15). Phase 1a only uses CH4 + N2O;
 * HFC/PFC/SF6/NF3 land in Phase 1c+ when decomposed EFs are introduced.
 */
export const GWP_AR6 = {
  CH4: 27.9,
  N2O: 273,
} as const;

export type ComputeInput = {
  /** User-entered activity amount in `unit`. */
  amount: number;
  /** User-entered unit (canonical or alias, e.g. 'kWh' / '度' / 'L' / '升'). */
  unit: string;
  /** Pre-pinned emission factor (see EfService.pin). */
  ef: PinnedEmissionFactor;
  /**
   * Optional fuel binding for cross-family conversion (e.g. kg gasoline → L).
   * Required when `unit` and `ef.input_unit` live in different unit families.
   */
  fuelCode?: string;
};

export type ComputeOutput = {
  /** Total CO2e in kg = direct + CH4·GWP + N2O·GWP. */
  co2e_kg: number;
  /** The user amount converted into the EF's `input_unit`. */
  amount_in_ef_unit: number;
  /**
   * Per-gas breakdown for audit / display. For Phase 1a's 12 seeded EFs,
   * `ch4_co2e_kg` and `n2o_co2e_kg` are always 0 because the seed leaves
   * ch4/n2o NULL (the AR6-weighted contribution is already baked into
   * `co2e_kg_per_unit`). Phase 1c+ EFs that decompose CO2/CH4/N2O will
   * surface non-zero values here.
   */
  breakdown: {
    direct_co2_kg: number;
    ch4_co2e_kg: number;
    n2o_co2e_kg: number;
  };
};

/**
 * Pure compute service: amount × pinned EF → CO2e (AR6 GWP100).
 *
 * Composition: takes a UnitConversionService via ctx so the caller controls
 * the db handle (no double-open) and tests can swap in a stub if needed.
 * No DB writes happen here — the only DB access is what UnitConversionService
 * does internally to read fuel_property + unit_definition.
 */
export class CalculationService {
  constructor(private readonly ctx: { unitConversion: UnitConversionService }) {}

  compute(input: ComputeInput): ComputeOutput {
    const { amount, unit, ef, fuelCode } = input;

    // 1. Convert user amount → EF's input_unit.
    // If a fuelCode is supplied, route through convertWithFuel (handles both
    // same-family — which just delegates back to convert — and cross-family).
    // Without fuelCode, a cross-family request will throw DimensionMismatchError
    // from UnitConversionService.convert.
    const amount_in_ef_unit =
      fuelCode !== undefined
        ? this.ctx.unitConversion.convertWithFuel(amount, unit, ef.input_unit, fuelCode)
        : this.ctx.unitConversion.convert(amount, unit, ef.input_unit);

    // 2. Apply the EF.
    // NOTE: `direct_co2_kg` is named for the formula's first term but, for
    // Phase 1a EFs, it already encapsulates the AR6-weighted total CO2e
    // (CH4 + N2O baked in by the publishing source). The CH4/N2O additive
    // terms below contribute 0 when those columns are NULL — Phase 1c+
    // decomposed EFs will populate them and the additive form kicks in.
    const direct_co2_kg = amount_in_ef_unit * ef.co2e_kg_per_unit;

    const ch4_co2e_kg =
      ef.ch4_kg_per_unit != null ? amount_in_ef_unit * ef.ch4_kg_per_unit * GWP_AR6.CH4 : 0;

    const n2o_co2e_kg =
      ef.n2o_kg_per_unit != null ? amount_in_ef_unit * ef.n2o_kg_per_unit * GWP_AR6.N2O : 0;

    const co2e_kg = direct_co2_kg + ch4_co2e_kg + n2o_co2e_kg;

    return {
      co2e_kg,
      amount_in_ef_unit,
      breakdown: {
        direct_co2_kg,
        ch4_co2e_kg,
        n2o_co2e_kg,
      },
    };
  }
}
