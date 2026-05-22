/**
 * Build the FTS5 query string for a given extraction.
 *
 * Pulls the salient free-text fields per stage and concatenates them
 * with spaces. FTS5's bm25 will then rank emission factors by which of
 * these tokens appear in their names/descriptions.
 *
 * Null / undefined / empty values are skipped. Unknown stage → empty
 * string (caller handles "no hint" as a fall-back signal).
 */
export function extractHint(stageId: string, parsed: Record<string, unknown>): string {
  const fields: Record<string, string[]> = {
    'china_utility.v1': ['supplier_name'],
    'fuel_receipt.v1': ['fuel_type', 'fuel_category'],
    'freight.v1': ['mode', 'vehicle_class', 'supplier_name'],
    'purchase.v1': ['category', 'item_description', 'supplier_name'],
    'travel.v1': ['mode', 'travel_class', 'supplier_name'],
  };
  const keys = fields[stageId];
  if (!keys) return '';
  return keys
    .map((k) => parsed[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ');
}
