import * as m from '@renderer/paraglide/messages';
import { type Driver, type DriveStep, driver, type PopoverDOM } from 'driver.js';
import 'driver.js/dist/driver.css';
import './guidance.css';
import { useEffect } from 'react';
import { hasSeenTour, isGuidanceEnabled, markTourSeen, type TourId } from './guidance-state';
import { getTour } from './tours';

/**
 * Plays one guidance tour the first time its screen is opened.
 *
 * Mount it anywhere on the screen it explains — it renders nothing of its
 * own (the popover is driver.js's DOM on `document.body`) and decides
 * once, on mount / when `ready` flips:
 *
 *   1. guidance enabled? (Settings switch; forced off under E2E)
 *   2. tour not seen yet?
 *   3. at least one anchor actually in the DOM?
 *
 * Rule 3 is why the start is deferred by a tick: routes mount their data
 * asynchronously, and a tour that points at nothing is worse than no
 * tour. If no anchor resolves we stay silent AND leave the tour unseen,
 * so it gets another chance once the screen has content.
 *
 * Finishing, skipping and Escape all mark the tour seen — "dismiss" means
 * permanently, per the roadmap's noise constraint; Settings → General can
 * replay them. Navigating away mid-tour does not: the tour ends, but it
 * stays unseen for the next visit.
 *
 * Copy is read when the tour starts rather than per render, so switching
 * language mid-tour leaves the running tour alone; the next play is in
 * the new language.
 */

/**
 * Give the route a beat to paint its data before we look for anchors.
 * Long enough for a react-query cache hit to render, short enough that
 * the tour still feels like part of arriving on the screen.
 */
const START_DELAY_MS = 400;

/**
 * Only one tour may play at a time, app-wide.
 *
 * Nested routes make double-mounting real: /questionnaires/$id renders
 * inside the /questionnaires two-pane layout, so both screens' tours are
 * alive at once. Two overlays stacked on one screen is exactly the noise
 * the roadmap warned about — so the first tour to start claims the slot
 * and the other stays unseen for a later visit.
 */
let activeTourId: TourId | null = null;

export interface GuidedTourProps {
  tourId: TourId;
  /**
   * Gate the tour on the screen being in the state it explains — e.g. the
   * report tour only makes sense once a report has been generated.
   * Defaults to true.
   */
  ready?: boolean;
}

export function GuidedTour({ tourId, ready = true }: GuidedTourProps) {
  useEffect(() => {
    if (!ready) return;
    if (!isGuidanceEnabled() || hasSeenTour(tourId)) return;

    let instance: Driver | null = null;
    let claimed = false;

    /**
     * The user is done with this tour — finished it, skipped it, or hit
     * Escape. All three mean "don't show me this again".
     *
     * `instance.destroy()` bypasses `onDestroyStarted`, so calling it
     * here cannot recurse.
     */
    const dismiss = () => {
      markTourSeen(tourId);
      if (activeTourId === tourId) activeTourId = null;
      instance?.destroy();
    };

    const timer = setTimeout(() => {
      if (activeTourId !== null) return;

      const steps: DriveStep[] = getTour(tourId)
        .steps.filter((step) => document.querySelector(step.target) !== null)
        .map((step) => ({
          element: step.target,
          popover: {
            title: step.title(),
            description: step.body(),
            align: 'center' as const,
            ...(step.placement ? { side: step.placement } : {}),
          },
        }));
      if (steps.length === 0) return;

      activeTourId = tourId;
      claimed = true;

      instance = driver({
        steps,
        popoverClass: 'carbonink-guidance',
        // Ink wash rather than a black scrim. driver applies this as an
        // inline style on the overlay path, so a CSS variable resolves.
        overlayColor: 'var(--color-foreground)',
        overlayOpacity: 0.32,
        stagePadding: 6,
        // Matches `rounded-md` on the surfaces being highlighted.
        stageRadius: 8,
        popoverOffset: 10,
        showProgress: steps.length > 1,
        progressText: '{{current}} / {{total}}',
        nextBtnText: m.guidance_next(),
        prevBtnText: m.guidance_back(),
        doneBtnText: m.guidance_done(),
        // The ✕ is replaced by an explicit skip button (see
        // decoratePopover); Escape still ends the tour via `allowClose`.
        showButtons: ['next', 'previous'],
        allowClose: true,
        // Clicking the dimmed area does nothing — dismissing is a
        // deliberate act, not a stray click.
        overlayClickBehavior: () => {},
        // Don't let a click land on the highlighted control while we are
        // explaining it (finalizing an answer mid-tour, say).
        disableActiveInteraction: true,
        animate: !prefersReducedMotion(),
        smoothScroll: !prefersReducedMotion(),
        onPopoverRender: (popover, opts) => {
          decoratePopover(popover, opts.driver, steps.length, opts.index ?? 0, dismiss);
        },
        // Every dismissal driver initiates itself — the done button, the
        // ✕-equivalent, Escape — lands here. Defining this hook makes US
        // responsible for the teardown call, which is exactly the seam we
        // want: mark seen, then tear down.
        //
        // (`onDestroyed` would be the obvious hook, but driver only fires
        // it once a step has finished its highlight animation, so an
        // early dismissal can skip it.)
        onDestroyStarted: dismiss,
      });
      instance.drive();
    }, START_DELAY_MS);

    return () => {
      clearTimeout(timer);
      // Navigating away mid-tour ends it WITHOUT marking it seen — the
      // user never got the whole thing, so it plays again next visit.
      // `destroy()` skips `onDestroyStarted`, so no seen flag is written.
      instance?.destroy();
      if (claimed && activeTourId === tourId) activeTourId = null;
    };
  }, [ready, tourId]);

  return null;
}

/**
 * Bend driver's popover into the shape the design system asks for: an
 * explicit "skip" instead of an ✕, no disabled-looking "back" on the
 * first step, and a progress indicator that announces properly ("2 / 3"
 * reads as a fraction to a screen reader).
 */
function decoratePopover(
  popover: PopoverDOM,
  instance: Driver,
  total: number,
  index: number,
  onSkip: () => void,
): void {
  popover.wrapper.setAttribute('data-testid', 'guidance-tooltip');

  popover.progress.setAttribute('role', 'status');
  popover.progress.setAttribute('aria-label', m.guidance_progress({ current: index + 1, total }));

  if (instance.isFirstStep()) {
    popover.previousButton.style.display = 'none';
  }

  if (!instance.isLastStep()) {
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'driver-popover-footer-btn driver-guidance-skip-btn';
    skip.textContent = m.guidance_skip();
    skip.addEventListener('click', onSkip);
    // Leftmost of the button group, ahead of back / next.
    popover.footerButtons.prepend(skip);
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
