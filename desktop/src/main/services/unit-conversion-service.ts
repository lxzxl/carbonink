import type { UnitDefinition } from '@shared/types.js';
import type Database from 'better-sqlite3';

export class UnknownUnitError extends Error {
  constructor(unit: string) {
    super(`Unknown unit: ${unit}`);
    this.name = 'UnknownUnitError';
  }
}

export class DimensionMismatchError extends Error {
  constructor(fromUnit: string, toUnit: string, fromFamily: string, toFamily: string) {
    super(
      `Cannot convert ${fromUnit} (${fromFamily}) to ${toUnit} (${toFamily}) without fuel_code binding.`,
    );
    this.name = 'DimensionMismatchError';
  }
}

type UnitDef = {
  unit: string;
  family: string;
  multiply_of_ratio: number;
  divide_of_ratio: number;
};

type FuelProperty = {
  fuel_code: string;
  density_kg_per_L: number | null;
  density_kg_per_m3: number | null;
  lower_heating_value_MJ_per_kg: number | null;
  lower_heating_value_MJ_per_m3: number | null;
};

export class UnitConversionService {
  constructor(private ctx: { db: Database.Database }) {}

  normalize(unitOrAlias: string): { unit: string; family: string } {
    // Try direct lookup in unit_definition.
    const def = this.ctx.db
      .prepare('SELECT unit, family FROM unit_definition WHERE unit = ?')
      .get(unitOrAlias) as { unit: string; family: string } | undefined;
    if (def) return def;

    // Fall back to alias resolution.
    const alias = this.ctx.db
      .prepare(
        `SELECT u.unit, u.family FROM unit_alias a
         JOIN unit_definition u ON a.canonical_unit = u.unit
         WHERE a.alias = ?`,
      )
      .get(unitOrAlias) as { unit: string; family: string } | undefined;
    if (alias) return alias;

    throw new UnknownUnitError(unitOrAlias);
  }

  convert(amount: number, fromUnit: string, toUnit: string): number {
    const from = this.normalize(fromUnit);
    const to = this.normalize(toUnit);

    if (from.family !== to.family) {
      throw new DimensionMismatchError(fromUnit, toUnit, from.family, to.family);
    }

    const fromDef = this.getUnitDef(from.unit);
    const toDef = this.getUnitDef(to.unit);

    // canonical = amount × multiply / divide
    const canonical = (amount * fromDef.multiply_of_ratio) / fromDef.divide_of_ratio;
    // target = canonical × divide / multiply
    return (canonical * toDef.divide_of_ratio) / toDef.multiply_of_ratio;
  }

  convertWithFuel(amount: number, fromUnit: string, toUnit: string, fuelCode: string): number {
    // Always validate fuel binding, even when the conversion ends up not needing it.
    // This guards callers (especially future FTS-matching paths in Phase 1c+) from
    // silently passing through bad fuel codes.
    const fuel = this.getFuelProperty(fuelCode);

    const from = this.normalize(fromUnit);
    const to = this.normalize(toUnit);

    // Same family: delegate to direct conversion.
    if (from.family === to.family) return this.convert(amount, fromUnit, toUnit);

    // Phase 1a supported cross-family paths: volume ↔ mass, mass ↔ energy,
    // volume ↔ energy. Compute intermediates in canonical units (kg, L, MJ).
    let intermediate_kg: number | undefined;
    let intermediate_MJ: number | undefined;

    if (from.family === 'volume') {
      const amountInL = this.convert(amount, fromUnit, 'L');
      if (fuel.density_kg_per_L != null) {
        intermediate_kg = amountInL * fuel.density_kg_per_L;
      } else if (fuel.density_kg_per_m3 != null) {
        const amountIn_m3 = amountInL / 1000;
        intermediate_kg = amountIn_m3 * fuel.density_kg_per_m3;
      }
      if (fuel.lower_heating_value_MJ_per_m3 != null) {
        intermediate_MJ = (amountInL / 1000) * fuel.lower_heating_value_MJ_per_m3;
      } else if (intermediate_kg != null && fuel.lower_heating_value_MJ_per_kg != null) {
        intermediate_MJ = intermediate_kg * fuel.lower_heating_value_MJ_per_kg;
      }
    } else if (from.family === 'mass') {
      intermediate_kg = this.convert(amount, fromUnit, 'kg');
      if (fuel.lower_heating_value_MJ_per_kg != null) {
        intermediate_MJ = intermediate_kg * fuel.lower_heating_value_MJ_per_kg;
      }
    } else if (from.family === 'energy') {
      intermediate_MJ = this.convert(amount, fromUnit, 'MJ');
      if (fuel.lower_heating_value_MJ_per_kg != null) {
        intermediate_kg = intermediate_MJ / fuel.lower_heating_value_MJ_per_kg;
      }
    }

    if (to.family === 'mass') {
      if (intermediate_kg == null) {
        throw new Error(`Cannot derive mass from ${fromUnit} via fuel ${fuelCode}`);
      }
      return this.convert(intermediate_kg, 'kg', toUnit);
    }
    if (to.family === 'volume') {
      if (intermediate_kg == null || fuel.density_kg_per_L == null) {
        throw new Error(`Cannot derive volume from ${fromUnit} via fuel ${fuelCode}`);
      }
      const intermediate_L_v = intermediate_kg / fuel.density_kg_per_L;
      return this.convert(intermediate_L_v, 'L', toUnit);
    }
    if (to.family === 'energy') {
      if (intermediate_MJ == null) {
        throw new Error(`Cannot derive energy from ${fromUnit} via fuel ${fuelCode}`);
      }
      return this.convert(intermediate_MJ, 'MJ', toUnit);
    }
    throw new Error(`Cannot convert to family ${to.family}`);
  }

  /**
   * Returns every row in `unit_definition`, ordered by (family, display_order)
   * so the renderer can render a grouped picker without further sorting.
   * Read-only catalog — safe to expose verbatim across the IPC boundary.
   */
  listAll(): UnitDefinition[] {
    return this.ctx.db
      .prepare(
        `SELECT unit, family, multiply_of_ratio, divide_of_ratio,
                display_order, display_name_zh, display_name_en
         FROM unit_definition
         ORDER BY family ASC, display_order ASC, unit ASC`,
      )
      .all() as UnitDefinition[];
  }

  isCompatible(unitA: string, unitB: string): boolean {
    try {
      const a = this.normalize(unitA);
      const b = this.normalize(unitB);
      return a.family === b.family;
    } catch {
      return false;
    }
  }

  private getUnitDef(unit: string): UnitDef {
    const def = this.ctx.db
      .prepare(
        'SELECT unit, family, multiply_of_ratio, divide_of_ratio FROM unit_definition WHERE unit = ?',
      )
      .get(unit) as UnitDef | undefined;
    if (!def) throw new UnknownUnitError(unit);
    return def;
  }

  private getFuelProperty(fuelCode: string): FuelProperty {
    const fuel = this.ctx.db
      .prepare(
        `SELECT fuel_code, density_kg_per_L, density_kg_per_m3,
                lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3
         FROM fuel_property WHERE fuel_code = ?`,
      )
      .get(fuelCode) as FuelProperty | undefined;
    if (!fuel) throw new Error(`Unknown fuel_code: ${fuelCode}`);
    return fuel;
  }
}
