import { chinaUtilityStage } from '@main/llm/stages/china-utility';
import { getStage, listStages, stageRegistry } from '@main/llm/stages/registry';
import { describe, expect, it } from 'vitest';

describe('stage registry', () => {
  it("getStage('china_utility.v1') returns the canonical stage", () => {
    expect(getStage('china_utility.v1')).toBe(chinaUtilityStage);
  });

  it('getStage returns undefined for an unknown id', () => {
    expect(getStage('does-not-exist.v1')).toBeUndefined();
  });

  it('listStages returns exactly one stage in Phase 1b', () => {
    const stages = listStages();
    expect(stages.length).toBe(1);
    expect(stages[0]?.id).toBe('china_utility.v1');
  });

  it('exposes the raw Map for callers that want size / iteration', () => {
    expect(stageRegistry.size).toBe(1);
    expect(stageRegistry.has('china_utility.v1')).toBe(true);
  });
});
