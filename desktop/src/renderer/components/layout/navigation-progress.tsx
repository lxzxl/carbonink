import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import LoadingBar, { type LoadingBarRef } from 'react-top-loading-bar';

/**
 * NavigationProgress — thin route-transition progress bar at the top of the
 * window. Adopted from shadcn-admin (https://shadcn-admin.netlify.app/) which
 * pairs TanStack Router's `useRouterState().status` with the
 * `react-top-loading-bar` package.
 *
 * Why we need this: most carbonbook detail routes do per-route loaders
 * (better-sqlite3 reads + IPC round-trip). On a fast Mac they're <50ms and
 * imperceptible, but on the first cold-cache load — or in dev when HMR is
 * thrashing — the user clicks a sidebar item and the previous route is still
 * showing for ~300ms. Without a progress bar, that feels broken ("did my
 * click register?"). With it, the bar starts immediately so the click is
 * visibly acknowledged even before the new route paints.
 *
 * Color uses `--muted-foreground` so it's subtle (matches the rest of the
 * desaturated chrome) rather than a primary-green accent that would compete
 * with active-state highlights in the sidebar.
 */
export function NavigationProgress() {
  const ref = useRef<LoadingBarRef>(null);
  const status = useRouterState({ select: (s) => s.status });

  useEffect(() => {
    if (status === 'pending') {
      ref.current?.continuousStart();
    } else {
      ref.current?.complete();
    }
  }, [status]);

  return <LoadingBar color="var(--muted-foreground)" ref={ref} shadow={true} height={2} />;
}
