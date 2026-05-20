import { licenseApi } from '@renderer/lib/api/license';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

/**
 * Top-of-app banner shown when the license is in `grace`, `expired`, or
 * `revoked`. Click "Open License settings" jumps to /settings#license
 * (sub-project G will refine the deep-link target; for now it just
 * navigates to /settings).
 *
 * Mounted in `__root.tsx` above the main flex container. Renders nothing
 * in `active` / `unverified` — pre-license users get the activation
 * widget on the Settings page instead of a banner.
 *
 * Refetch interval: 60 s. Once a user crosses the expires_at boundary the
 * banner should appear within a minute without a manual refresh; cheaper
 * than a global ticker since most polls are no-ops.
 */
export function LicenseBanner() {
  const stateQuery = useQuery({
    queryKey: ['license:get-state'],
    queryFn: licenseApi.getState,
    refetchInterval: 60_000,
  });

  const view = stateQuery.data;
  if (!view) return null;
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
