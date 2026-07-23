/**
 * Typed comparators — the "is this field actually right?" layer of the eval.
 *
 * Pure + deterministic: no model, no network. (These are the only part of an
 * eval that COULD live in CI; the model calls can't — cost + nondeterminism.)
 * Each field declares how it's compared so "1,234.50 kWh" vs 1234.5 counts as
 * a hit but a wrong supplier name doesn't.
 */

export type Cmp = 'string' | 'supplier' | 'id' | 'number' | 'date';
export interface FieldSpec {
  cmp: Cmp;
  tol?: number;
}

/** The fields we score for china_utility (doc_type is fixed; confidence is
 *  calibration, not correctness — so neither is scored here). */
export const FIELD_SPECS: Record<string, FieldSpec> = {
  supplier_name: { cmp: 'supplier' },
  account_no: { cmp: 'id' },
  amount_kwh: { cmp: 'number', tol: 0.005 },
  amount_yuan: { cmp: 'number', tol: 0.005 },
  period_start: { cmp: 'date' },
  period_end: { cmp: 'date' },
};

/** The field(s) that drive CO₂e — the metric that most predicts downstream
 *  correctness. Tracked separately from the all-fields-hit rate. */
export const CRITICAL_FIELDS = ['amount_kwh'];

function normStr(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC') // full-width → half-width, compatibility forms
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Supplier names: the standard short forms are equivalent to the full names
 * (国网 == 国家电网, 南网 == 南方电网). Without folding these, a correct
 * extraction that uses the common abbreviation scores as a miss — the first
 * real finding from the eval (the model was right; the metric was too strict).
 * Deterministic + explainable; a genuinely different name still misses.
 */
function normSupplier(s: unknown): string {
  return normStr(s).replaceAll('国家电网', '国网').replaceAll('南方电网', '南网');
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v)
    .replace(/,/g, '')
    .replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normDate(v: unknown): string {
  const s = String(v ?? '')
    .trim()
    .replace(/[/.]/g, '-');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

export function compareField(cmp: Cmp, expected: unknown, actual: unknown, tol = 0.005): boolean {
  // Nullable contract: both empty/null → hit (correctly left blank); one empty
  // and the other not → miss (a hallucinated value, or a dropped one).
  const expEmpty = expected == null || expected === '';
  const actEmpty = actual == null || actual === '';
  if (expEmpty && actEmpty) return true;
  if (expEmpty !== actEmpty) return false;

  switch (cmp) {
    case 'string':
      return normStr(expected) === normStr(actual);
    case 'supplier':
      return normSupplier(expected) === normSupplier(actual);
    case 'id':
      return normStr(expected).replace(/[\s-]/g, '') === normStr(actual).replace(/[\s-]/g, '');
    case 'date':
      return normDate(expected) === normDate(actual);
    case 'number': {
      const e = toNumber(expected);
      const a = toNumber(actual);
      if (e == null || a == null) return false;
      return Math.abs(a - e) <= Math.max(tol * Math.abs(e), 0.01);
    }
  }
}

export interface ItemScore {
  fields: Record<string, boolean>;
  allHit: boolean;
  criticalHit: boolean;
}

export function scoreItem(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | null,
): ItemScore {
  const fields: Record<string, boolean> = {};
  for (const [name, spec] of Object.entries(FIELD_SPECS)) {
    fields[name] = actual ? compareField(spec.cmp, expected[name], actual[name], spec.tol) : false;
  }
  return {
    fields,
    allHit: Object.values(fields).every(Boolean),
    criticalHit: CRITICAL_FIELDS.every((f) => fields[f] === true),
  };
}
