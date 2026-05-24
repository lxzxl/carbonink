import { licenseApi } from '@renderer/lib/api/license';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

/**
 * Top-of-app banner — URGENT states only. The "comfortable runway" trial
 * state (days remaining > 3) renders as a compact `<LicenseChip />` in the
 * Header's right slot instead — see `LicenseChip.tsx` for the rationale.
 *
 * Branches:
 *
 *   - active + trial plan + days ≤ 3:     destructive banner with countdown
 *                                         + "Upgrade" CTA (high-urgency).
 *   - grace:                              amber "in grace period" banner.
 *   - expired / revoked:                  destructive read-only banner.
 *   - everything else (active paid, trial > 3 days, unverified): render
 *                                         nothing here — chip OR no chrome.
 *
 * "Upgrade" opens the public pricing page in the user's default browser
 * via the main process's setWindowOpenHandler → shell.openExternal route
 * (`src/main/window.ts`). No dedicated IPC channel — `window.open` is
 * intercepted at the BrowserWindow level.
 *
 * Refetch: 60 s. Trial countdown rolls over on the minute, not the second,
 * which is fine — sub-minute granularity adds no value to a 14-day trial.
 */
export function LicenseBanner() {
  const stateQuery = useQuery({
    queryKey: ['license:get-state'],
    queryFn: licenseApi.getState,
    refetchInterval: 60_000,
  });

  const view = stateQuery.data;
  if (!view) return null;

  // ---- Trial countdown branch — ONLY when ≤ 3 days remaining ----
  // `active` + plan beginning with `trial` (e.g., `trial@14d`).
  // > 3 days falls through to the LicenseChip in the Header (see top
  // comment block). Days = floor((expires_at - now) / 86400), clamped 0.
  const isTrial =
    view.state === 'active' && view.claims != null && view.claims.plan.startsWith('trial');

  if (isTrial && view.claims != null) {
    const daysRemaining = Math.max(
      0,
      Math.floor((view.claims.expires_at - Math.floor(Date.now() / 1000)) / 86400),
    );
    if (daysRemaining > 3) return null;
    return (
      <div
        role="status"
        className="border-b px-4 py-1.5 text-xs border-destructive/50 bg-destructive/15 text-destructive flex items-center justify-between gap-3"
      >
        <div className="font-medium">
          {m.license_banner_trial_title({ days: String(daysRemaining) })}
        </div>
        <button
          type="button"
          onClick={() => window.open('https://carbonink.xyz/pricing', '_blank')}
          className="rounded-md border border-current px-2.5 py-0.5 text-xs font-medium hover:bg-current/10 whitespace-nowrap"
        >
          {m.license_banner_upgrade_cta()}
        </button>
      </div>
    );
  }

  // ---- Grace / expired / revoked branches ----
  if (view.state !== 'grace' && view.state !== 'expired' && view.state !== 'revoked') {
    return null;
  }

  let title: string;
  let body: string;
  let palette: 'amber' | 'destructive';
  if (view.state === 'grace') {
    const daysRemaining =
      view.claims != null
        ? Math.max(0, Math.floor((view.claims.grace_until - Math.floor(Date.now() / 1000)) / 86400))
        : 0;
    title = m.license_banner_grace_title({ days: String(daysRemaining) });
    body = m.license_banner_grace_body();
    palette = 'amber';
  } else if (view.state === 'expired') {
    title = m.license_banner_expired_title();
    body = m.license_banner_expired_body();
    palette = 'destructive';
  } else {
    title = m.license_banner_revoked_title();
    body = m.license_banner_revoked_body();
    palette = 'destructive';
  }

  const paletteClasses =
    palette === 'amber'
      ? 'border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100'
      : 'border-destructive/50 bg-destructive/15 text-destructive';

  return (
    <div
      role="alert"
      className={`border-b px-4 py-2 text-sm ${paletteClasses} flex items-center justify-between gap-3`}
    >
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs opacity-90">{body}</div>
      </div>
      <Link
        to="/settings"
        className="rounded-md border border-current px-3 py-1 text-xs font-medium hover:bg-current/10 whitespace-nowrap"
      >
        {m.license_banner_renew_cta()}
      </Link>
    </div>
  );
}
