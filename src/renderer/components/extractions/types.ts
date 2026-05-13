import type { ChinaUtilityParsed } from './china-utility/types';
import type { FreightParsed } from './freight/types';
import type { FuelReceiptParsed } from './fuel-receipt/types';
import type { PurchaseParsed } from './purchase/types';
import type { TravelParsed } from './travel/types';

/**
 * Discriminated union over the 5 stage-version-specific parsed types.
 * The `stage` tag matches `Extraction.prompt_version` exactly so the
 * orchestrator can switch on it without re-parsing.
 */
export type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed }
  | { stage: 'purchase.v1'; data: PurchaseParsed }
  | { stage: 'travel.v1'; data: TravelParsed };

/**
 * Parse persisted extraction JSON for a known stage. Returns `null` for
 * malformed JSON or an unknown promptVersion. The discriminator is the
 * persisted prompt_version, not anything inside parsed_json itself.
 */
export function parseExtraction(raw: string | null, promptVersion: string): StageParsed | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (promptVersion === 'china_utility.v1') {
    return { stage: 'china_utility.v1', data: obj as ChinaUtilityParsed };
  }
  if (promptVersion === 'fuel_receipt.v1') {
    return { stage: 'fuel_receipt.v1', data: obj as FuelReceiptParsed };
  }
  if (promptVersion === 'freight.v1') {
    return { stage: 'freight.v1', data: obj as FreightParsed };
  }
  if (promptVersion === 'purchase.v1') {
    return { stage: 'purchase.v1', data: obj as PurchaseParsed };
  }
  if (promptVersion === 'travel.v1') {
    return { stage: 'travel.v1', data: obj as TravelParsed };
  }
  return null;
}
