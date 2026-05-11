import { chinaUtilityStage } from './china-utility.js';
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
export const stageRegistry: ReadonlyMap<string, Stage> = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
]);

export function getStage(id: string): Stage | undefined {
  return stageRegistry.get(id);
}

export function listStages(): Stage[] {
  return Array.from(stageRegistry.values());
}
