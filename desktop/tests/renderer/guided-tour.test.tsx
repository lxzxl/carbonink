import {
  GuidedTour,
  hasSeenTour,
  markTourSeen,
  setGuidanceEnabled,
} from '@renderer/features/guidance';
import * as m from '@renderer/paraglide/messages';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The first-visit contract for guidance tours: play once when the screen
 * it explains is actually on screen, stay silent forever after the user
 * dismisses it, and never play into a screen with no anchors.
 */

/** Anchors matching the `questionnaires` tour definition. */
function Screen({ withAnchors = true }: { withAnchors?: boolean }) {
  return (
    <div>
      {withAnchors && (
        <>
          <button type="button" data-tour="questionnaire-new">
            new
          </button>
          <div data-tour="questionnaire-list">list</div>
        </>
      )}
      <GuidedTour tourId="questionnaires" />
    </div>
  );
}

const TOOLTIP = 'guidance-tooltip';

/** The tour starts on a timer — give it room without a fixed sleep. */
const findTooltip = () => screen.findByTestId(TOOLTIP, {}, { timeout: 3000 });

async function expectSilence() {
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(screen.queryByTestId(TOOLTIP)).toBeNull();
}

describe('GuidedTour', () => {
  beforeEach(() => {
    localStorage.clear();
    window.carbonink = { suppressGuidance: false };
  });
  afterEach(cleanup);

  it('plays on the first visit to a screen it has anchors on', async () => {
    render(<Screen />);
    const tooltip = await findTooltip();
    expect(tooltip.textContent).toContain(m.guidance_questionnaires_new_title());
  });

  it('marks the tour seen when the user skips it', async () => {
    render(<Screen />);
    await findTooltip();
    // by role+name: the accessible name comes from joyride's `locale`, so
    // this also pins that the buttons announce in the app's language.
    fireEvent.click(screen.getByRole('button', { name: m.guidance_skip() }));

    await waitFor(() => expect(screen.queryByTestId(TOOLTIP)).toBeNull());
    expect(hasSeenTour('questionnaires')).toBe(true);
  });

  it('stays silent on later visits', async () => {
    markTourSeen('questionnaires');
    render(<Screen />);
    await expectSilence();
  });

  it('stays silent when guidance is switched off', async () => {
    setGuidanceEnabled(false);
    render(<Screen />);
    await expectSilence();
  });

  it('plays one tour at a time when two are mounted together', async () => {
    // /questionnaires/$id renders inside the /questionnaires layout, so
    // both screens' tours are alive at once — only one may take over.
    render(
      <div>
        <div data-tour="questionnaire-list">list</div>
        <div data-tour="answer-card">card</div>
        <GuidedTour tourId="questionnaires" />
        <GuidedTour tourId="answer-review" />
      </div>,
    );
    await findTooltip();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getAllByTestId(TOOLTIP)).toHaveLength(1);
  });

  it('leaves the tour unseen when the screen is left mid-tour', async () => {
    const view = render(<Screen />);
    await findTooltip();
    // Navigating away unmounts the route — the user never finished, so
    // the tour has to play again next time.
    view.unmount();
    await waitFor(() => expect(screen.queryByTestId(TOOLTIP)).toBeNull());
    expect(hasSeenTour('questionnaires')).toBe(false);
  });

  it('stays silent — and unseen — when no anchor is on screen', async () => {
    render(<Screen withAnchors={false} />);
    await expectSilence();
    // Unseen, so the tour gets another chance once the screen has content.
    expect(hasSeenTour('questionnaires')).toBe(false);
  });
});
