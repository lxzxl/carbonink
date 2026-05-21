import { cn } from '@renderer/lib/utils';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * Compact list-column row (Round 3 redesign).
 *
 * Used by the left pane of every two-pane route (`/documents`,
 * `/questionnaires`, `/reports`, `/audit`). Pattern:
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ ● [leading]   Title that may truncate…       [right] │
 *   │              meta · meta · meta                       │
 *   └───────────────────────────────────────────────────────┘
 *
 * - `leading`: optional ReactNode (status dot, avatar, icon). Caller
 *   provides full styling — keeps the primitive shape-agnostic.
 * - `title` and `meta` are the two text rows. Title truncates with
 *   `title={titleString}` for hover tooltip.
 * - `right`: optional trailing ReactNode (chevron, badge count).
 * - `isSelected`: when true, applies the sidebar-accent highlight.
 *
 * Renders as either a `<Link>` (when `to` is provided — wraps TanStack
 * Router) or a `<button>` (when `onClick` is provided — local-state
 * selection like `/audit`).
 */

type Common = {
  leading?: ReactNode;
  title: ReactNode;
  /** Plain string for the `title` HTML attribute (hover tooltip). */
  titleAttr?: string | undefined;
  meta?: ReactNode;
  right?: ReactNode;
  isSelected?: boolean | undefined;
  className?: string | undefined;
};

type AsLink = Common & {
  to: LinkProps['to'];
  params?: LinkProps['params'];
  ariaLabel?: string;
  onClick?: never;
};
type AsButton = Common & {
  onClick: () => void;
  ariaLabel?: string;
  to?: never;
  params?: never;
};

export type ListItemProps = AsLink | AsButton;

const baseClasses =
  'flex w-full items-start gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent/60';

function Body({
  leading,
  title,
  titleAttr,
  meta,
  right,
}: {
  leading?: ReactNode;
  title: ReactNode;
  titleAttr?: string | undefined;
  meta?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground" title={titleAttr}>
          {title}
        </div>
        {meta && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {right}
    </>
  );
}

export function ListItem(props: ListItemProps) {
  const classes = cn(baseClasses, props.isSelected && 'bg-sidebar-accent', props.className);
  if ('to' in props && props.to) {
    return (
      <li>
        <Link
          to={props.to}
          // biome-ignore lint/suspicious/noExplicitAny: TanStack's `params` type is path-dependent; the typed callsite above keeps this safe.
          params={props.params as any}
          aria-label={props.ariaLabel}
          className={classes}
        >
          <Body
            leading={props.leading}
            title={props.title}
            titleAttr={props.titleAttr}
            meta={props.meta}
            right={props.right}
          />
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.ariaLabel}
        className={classes}
      >
        <Body
          leading={props.leading}
          title={props.title}
          titleAttr={props.titleAttr}
          meta={props.meta}
          right={props.right}
        />
      </button>
    </li>
  );
}

/**
 * 8×8 colored dot used as the leading element on Documents + future
 * status-prefixed lists. Color is a Tailwind class string from the
 * caller — keeps the primitive token-agnostic. The mt-1.5 vertically
 * aligns the dot with the first row of two-line content (title at
 * text-sm ≈ 20px line-height).
 */
export function StatusDot({ className }: { className: string }) {
  return (
    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', className)} aria-hidden="true" />
  );
}
