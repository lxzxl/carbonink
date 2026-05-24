import { licenseApi } from '@renderer/lib/api/license';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';

/**
 * LicenseChip — compact trial-countdown chip that sits in the Header's
 * right slot.
 *
 * Replaces the full-width `LicenseBanner` for the "active trial, comfortable
 * runway" case (> 3 days remaining). The banner had two problems for this
 * state:
 *
 *   1. Takes a horizontal stripe on every page. Settings/Reports/Documents
 *      are content-dense and lose ~32px of vertical real estate for no
 *      action the user has to take right now.
 *   2. Repeated exposure on every paint trains users to dismiss it (banner
 *      blindness). When the trial actually approaches expiry, the user has
 *      already learned to skim past the strip.
 *
 * Chip in the Header's top-right (where macOS apps put account/subscription
 * status) is a more native-feel placement: low visual weight, clickable,
 * out of the content path. The banner still renders for urgent states
 * (`daysRemaining ≤ 3`, grace, expired, revoked) — see `LicenseBanner.tsx`
 * for the disjoint condition.
 *
 * Click: opens https://carbonink.xyz/pricing in the default browser via the
 * main process's `setWindowOpenHandler → shell.openExternal` route
 * (`src/main/window.ts`). No IPC needed — `window.open` is intercepted at
 * the BrowserWindow level.
 *
 * Refetch 60 s, same cadence as the banner — countdown rolls over on the
 * minute, sub-minute granularity adds no value to a 14-day trial.
 */
export function LicenseChip() {
  const stateQuery = useQuery({
    queryKey: ['license:get-state'],
    queryFn: licenseApi.getState,
    refetchInterval: 60_000,
  });

  const view = stateQuery.data;
  if (!view) return null;

  const isTrial =
    view.state === 'active' && view.claims != null && view.claims.plan.startsWith('trial');
  if (!isTrial || view.claims == null) return null;

  const daysRemaining = Math.max(
    0,
    Math.floor((view.claims.expires_at - Math.floor(Date.now() / 1000)) / 86400),
  );

  // Only render here for the "comfortable runway" case. ≤ 3 days falls
  // through to the banner — at that point the user needs higher-weight
  // visual treatment, not a chip easy to miss.
  if (daysRemaining <= 3) return null;

  // Days 4–7: warm amber tone to start signaling urgency without yet
  // promoting to the banner. Days 8+: muted neutral.
  const amber = daysRemaining <= 7;
  return (
    <button
      type="button"
      onClick={() => window.open('https://carbonink.xyz/pricing', '_blank')}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        '[-webkit-app-region:no-drag]',
        amber
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 hover:bg-amber-500/15 dark:text-amber-100'
          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      title={m.license_banner_trial_title({ days: String(daysRemaining) })}
      aria-label={m.license_banner_trial_title({ days: String(daysRemaining) })}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          amber ? 'bg-amber-500' : 'bg-muted-foreground/60',
        )}
      />
      {m.license_chip_trial_short({ days: String(daysRemaining) })}
      <span className="opacity-70">›</span>
    </button>
  );
}
