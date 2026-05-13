import { chinaUtilityStage } from './china-utility.js';
import { freightStage } from './freight.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import { purchaseStage } from './purchase.js';
import type { Stage } from './types.js';

/**
 * The single source of truth for extraction stages. `ExtractionService` and
 * the `stages:list` IPC handler both read from this map; new stages get
 * appended here and nowhere else.
 *
 * The map is `Stage<unknown>` to allow stages with different inferred T's
 * to coexist. Each consumer narrows back to the stage's specific type at
 * the call site (e.g. by importing `chinaUtilityStage` directly when it
 * needs `ChinaUtilityExtraction`).
 */
const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
  [freightStage.id, freightStage as Stage],
  [purchaseStage.id, purchaseStage as Stage],
]);

export const stageRegistry: ReadonlyMap<string, Stage> = _stageRegistry;

export function getStage(id: string): Stage | undefined {
  return stageRegistry.get(id);
}

export function listStages(): Stage[] {
  return Array.from(stageRegistry.values());
}

/**
 * Test helper — registers a stage at runtime so tests can verify the
 * orchestrator's behavior on stages that aren't part of the default
 * registry. Not called in production code paths; the export is not
 * compile-time gated to `NODE_ENV==='test'` (would require a build-step
 * tree-shake we don't have set up), so don't `import` it from any
 * production module. Adding a new production stage should mutate the
 * literal `Map(...)` on line 14, not call this function.
 */
export function registerStage<T>(stage: Stage<T>): void {
  _stageRegistry.set(stage.id, stage as Stage<unknown>);
}
