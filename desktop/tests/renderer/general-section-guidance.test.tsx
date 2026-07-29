vi.mock('@renderer/components/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { GeneralSection } from '@renderer/components/settings/GeneralSection';
import { getSeenTours, isGuidanceEnabled, markTourSeen } from '@renderer/features/guidance';
import * as m from '@renderer/paraglide/messages';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings → General owns the two escape hatches for guidance tours:
 * turn them off entirely, or replay the ones already dismissed.
 */
describe('Settings → General: guided tours', () => {
  beforeEach(() => {
    localStorage.clear();
    window.carbonink = { suppressGuidance: false };
  });
  afterEach(cleanup);

  it('switches guidance off and back on', () => {
    render(<GeneralSection />);
    expect(isGuidanceEnabled()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: m.settings_general_guidance_off() }));
    expect(isGuidanceEnabled()).toBe(false);
    expect(
      screen
        .getByRole('button', { name: m.settings_general_guidance_off() })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: m.settings_general_guidance_on() }));
    expect(isGuidanceEnabled()).toBe(true);
  });

  it('replays every dismissed tour', () => {
    markTourSeen('questionnaires');
    markTourSeen('extraction');
    render(<GeneralSection />);

    fireEvent.click(screen.getByRole('button', { name: m.settings_general_guidance_replay() }));
    expect(getSeenTours()).toEqual([]);
  });
});
