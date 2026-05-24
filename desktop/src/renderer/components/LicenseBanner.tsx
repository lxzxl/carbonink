import { licenseApi } from '@renderer/lib/api/license';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

/**
 * Top-of-app banner. Branches by license state:
 *
 *   - active + plan starts with "trial":  muted info chip with countdown
 *                                         + "Upgrade" CTA. Always shown
 *                                         (the user wants the trial
 *                                         remaining-days visible at all
 *                                         times); palette tightens as the
 *                                         deadline approaches (default →
 *                                         amber at ≤7d → destructive at ≤3d).
 *   - grace:                              amber "in grace period" banner
 *   - expired / revoked:                  destructive read-only banner
 *   - active (paid) / unverified:         render nothing
 *
 * "Upgrade" opens the public pricing page in the user's default browser
 * via the main process's setWindowOpenHandler → shell.openExternal route
 * configured in `desktop/src/main/window.ts` (so window.open works as a
 * native escape hatch without a dedicated IPC channel).
 *
 * Refetch: 60 s. Trial countdown rolls over on the minute, not the second,
 * which is fine for a 14-day trial — the granularity below "days" doesn't
 * help anyone make a buying decision.
 */
export function LicenseBanner() {
  const stateQuery = useQuery({
    queryKey: ['license:get-state'],
    queryFn: licenseApi.getState,
    refetchInterval: 60_000,
  });

  const view = stateQuery.data;
  if (!view) return null;

  // ---- Trial countdown branch ----
  // `active` + plan beginning with `trial` (e.g., `trial@14d`).
  // Computed days = floor((expires_at - now) / 86400), clamped at 0.
  const isTrial =
    view.state === 'active' && view.claims != null && view.claims.plan.startsWith('trial');

  if (isTrial && view.claims != null) {
    const daysRemaining = Math.max(
      0,
      Math.floor((view.claims.expires_at - Math.floor(Date.now() / 1000)) / 86400),
    );
    const palette =
      daysRemaining <= 3 ? 'destructive' : daysRemaining <= 7 ? 'amber' : 'muted';
    const paletteClasses =
      palette === 'destructive'
        ? 'border-destructive/50 bg-destructive/15 text-destructive'
        : palette === 'amber'
          ? 'border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100'
          : 'border-border bg-muted/40 text-foreground';
    return (
      <div
        role="status"
        className={`border-b px-4 py-1.5 text-xs ${paletteClasses} flex items-center justify-between gap-3`}
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
