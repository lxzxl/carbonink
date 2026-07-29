import { currentLocale } from '@renderer/lib/i18n';
import * as m from '@renderer/paraglide/messages';
import { useEffect, useMemo, useState } from 'react';
import { EVENTS, type EventData, Joyride, type Step } from 'react-joyride';
import { hasSeenTour, isGuidanceEnabled, markTourSeen, type TourId } from './guidance-state';
import { TourTooltip } from './TourTooltip';
import { getTour } from './tours';

/**
 * Plays one guidance tour the first time its screen is opened.
 *
 * Mount it anywhere on the screen it explains — it renders nothing until
 * it decides to run. The decision (once, on mount / when `ready` flips):
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
 * Finishing, skipping or closing all mark the tour seen — "dismiss" means
 * permanently, per the roadmap's noise constraint. Settings → General can
 * replay them.
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
  const [run, setRun] = useState(false);
  // Which anchors were present when we started. null = not started.
  const [presentTargets, setPresentTargets] = useState<string[] | null>(null);
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);
  // Re-derive step copy when the app language changes mid-tour.
  const locale = currentLocale();

  useEffect(() => {
    if (!ready) return;
    if (!isGuidanceEnabled() || hasSeenTour(tourId)) return;

    let claimed = false;
    const timer = setTimeout(() => {
      if (activeTourId !== null) return;
      const tour = getTour(tourId);
      const present = tour.steps
        .map((s) => s.target)
        .filter((selector) => document.querySelector(selector) !== null);
      if (present.length === 0) return;

      if (tour.portalTarget) {
        const host = document.querySelector(tour.portalTarget);
        // A tour that must be portalled (it plays inside a modal) but
        // whose host is gone would render an unclickable tooltip — skip.
        if (!(host instanceof HTMLElement)) return;
        setPortalElement(host);
      }
      activeTourId = tourId;
      claimed = true;
      setPresentTargets(present);
      setRun(true);
    }, START_DELAY_MS);

    return () => {
      clearTimeout(timer);
      if (claimed && activeTourId === tourId) activeTourId = null;
    };
  }, [ready, tourId]);

  const steps = useMemo<Step[]>(() => {
    if (!presentTargets) return [];
    // `locale` is not read here — it is a dependency so the memo rebuilds
    // (and joyride re-renders the tooltip) after a language switch.
    void locale;
    return getTour(tourId)
      .steps.filter((s) => presentTargets.includes(s.target))
      .map((s) => ({
        target: s.target,
        title: s.title(),
        content: s.body(),
        ...(s.placement ? { placement: s.placement } : {}),
      }));
  }, [tourId, presentTargets, locale]);

  const tour = getTour(tourId);

  const options = useMemo(
    () => ({
      // Ledger surface: the tooltip is ours (TourTooltip), so these only
      // cover the bits joyride paints itself — arrow, overlay, spotlight.
      arrowColor: 'var(--color-popover)',
      overlayColor: 'color-mix(in oklab, var(--color-foreground) 32%, transparent)',
      spotlightPadding: 6,
      spotlightRadius: 8,
      // Above drawers (z-50) but below nothing else we own.
      zIndex: 60,
      hideOverlay: tour.hideOverlay ?? false,
      // No pulsing beacon — the tour opens straight into the tooltip.
      skipBeacon: true,
      // Don't let a click land on the highlighted control while we are
      // explaining it (finalizing an answer mid-tour, say).
      blockTargetInteraction: true,
      overlayClickAction: false as const,
      // ✕ ends the tour rather than stepping forward — dismiss is dismiss.
      closeButtonAction: 'skip' as const,
      buttons: ['back' as const, 'primary' as const, 'skip' as const],
      // Our own trap would fight vaul/Radix's inside a drawer.
      disableFocusTrap: true,
      skipScroll: prefersReducedMotion(),
      scrollDuration: prefersReducedMotion() ? 0 : 300,
    }),
    [tour.hideOverlay],
  );

  if (!run || steps.length === 0) return null;

  const handleEvent = (data: EventData) => {
    if (data.type === EVENTS.TOUR_END) {
      setRun(false);
      markTourSeen(tourId);
      if (activeTourId === tourId) activeTourId = null;
      return;
    }
    // An anchor vanished mid-tour (route re-render dropped it). Bail out
    // quietly and leave the tour unseen so it can play again later.
    if (data.type === EVENTS.TARGET_NOT_FOUND || data.type === EVENTS.ERROR) {
      setRun(false);
      if (activeTourId === tourId) activeTourId = null;
    }
  };

  return (
    <Joyride
      run
      continuous
      steps={steps}
      tooltipComponent={TourTooltip}
      // joyride derives each button's aria-label from these; without them
      // the buttons announce as English ("Next", "Skip") under a zh UI,
      // whatever the visible label says.
      locale={{
        back: m.guidance_back(),
        close: m.guidance_done(),
        last: m.guidance_done(),
        next: m.guidance_next(),
        skip: m.guidance_skip(),
      }}
      options={options}
      onEvent={handleEvent}
      {...(portalElement ? { portalElement } : {})}
    />
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
