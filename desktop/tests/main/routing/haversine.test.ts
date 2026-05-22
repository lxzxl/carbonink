import { distanceByAirport, parseIataFromString } from '@main/services/routing/haversine';
import { describe, expect, it } from 'vitest';

describe('distanceByAirport', () => {
  it('computes great-circle distance between PEK and JFK', () => {
    const result = distanceByAirport('PEK', 'JFK');
    if ('error' in result) throw new Error('expected ok');
    // PEK → JFK is ~11,000 km. Allow ±3% for haversine vs WGS84 rounding.
    expect(result.distance_km).toBeGreaterThan(10700);
    expect(result.distance_km).toBeLessThan(11300);
  });

  it('returns AirportUnknown error for unknown IATA', () => {
    const result = distanceByAirport('PEK', 'ZZZ');
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error._tag).toBe('AirportUnknown');
    expect(result.error.iata).toBe('ZZZ');
  });
});

describe('parseIataFromString', () => {
  it('extracts IATA from "Beijing PEK"', () => {
    expect(parseIataFromString('Beijing PEK')).toBe('PEK');
  });

  it('extracts IATA from "PEK"', () => {
    expect(parseIataFromString('PEK')).toBe('PEK');
  });

  it('returns null for "Beijing" (no IATA)', () => {
    expect(parseIataFromString('Beijing')).toBeNull();
  });
});
