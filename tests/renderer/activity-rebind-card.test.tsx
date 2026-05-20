import { ActivityRebindCard } from '@renderer/components/audit/ActivityRebindCard';
import type { AuditEvent } from '@shared/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const event: AuditEvent = {
  id: 'aud-1',
  event_kind: 'activity_rebind_ef',
  payload: JSON.stringify({
    activity_id: '01HXX9YYABCDEFGHIJKLMNOPQR',
    old_ef: {
      factor_code: 'diesel_L',
      year: 2024,
      source: 'MEE',
      geography: 'CN',
      dataset_version: '2024.1',
    },
    new_ef: {
      factor_code: 'diesel_kg',
      year: 2025,
      source: 'IPCC',
      geography: 'CN',
      dataset_version: '2025.1',
    },
    old_amount: 1000,
    old_unit: 'L',
    old_computed_co2e_kg: 2680,
    new_amount: 800,
    new_unit: 'kg',
    new_computed_co2e_kg: 2540,
  }),
  occurred_at: '2026-05-20T12:00:00Z',
};

describe('<ActivityRebindCard>', () => {
  it('renders summary with shortened activity id + old/new EF codes', () => {
    render(<ActivityRebindCard event={event} />);
    // Activity id shortened to first 8 chars
    expect(screen.getByText(/01HXX9YY/)).toBeTruthy();
    expect(screen.getByText(/diesel_L/)).toBeTruthy();
    expect(screen.getByText(/diesel_kg/)).toBeTruthy();
  });

  it('renders delta with signed values and percentage', () => {
    render(<ActivityRebindCard event={event} />);
    // Delta = 2540 - 2680 = -140; pct = -140/2680*100 ≈ -5.2%
    // The delta line contains: CO2e: 2,680 kg → 2,540 kg (-140 kg, -5.2%)
    const deltaElements = screen.getAllByText((content) => content.includes('CO2e'));
    expect(deltaElements.length).toBeGreaterThan(0);
    const deltaText = deltaElements[0]?.textContent;
    expect(deltaText).toBeTruthy();
    expect(deltaText).toMatch(/2[,\s]*680/);
    expect(deltaText).toMatch(/2[,\s]*540/);
    expect(deltaText).toMatch(/-140/);
    expect(deltaText).toMatch(/-5\.2/);
  });
});
