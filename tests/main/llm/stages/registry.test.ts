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

  it('listStages returns all registered stages (china_utility.v1, fuel_receipt.v1, and freight.v1)', () => {
    const stages = listStages();
    expect(stages.length).toBe(3);
    const ids = stages.map((s) => s.id);
    expect(ids).toContain('china_utility.v1');
    expect(ids).toContain('fuel_receipt.v1');
    expect(ids).toContain('freight.v1');
  });

  it('exposes the raw Map for callers that want size / iteration', () => {
    expect(stageRegistry.size).toBe(3);
    expect(stageRegistry.has('china_utility.v1')).toBe(true);
    expect(stageRegistry.has('fuel_receipt.v1')).toBe(true);
    expect(stageRegistry.has('freight.v1')).toBe(true);
  });
});
