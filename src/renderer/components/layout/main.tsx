import { cn } from '@renderer/lib/utils';

/**
 * Main — page content wrapper, adopted from shadcn-admin.
 *
 *   - `fluid={true}` (default false): drop the max-width cap; for routes
 *     that legitimately want edge-to-edge content (two-pane list/detail
 *     layouts like /documents, /questionnaires).
 *   - `fixed={true}` (default false): the main becomes a flex-grow column
 *     with overflow clipped — for routes whose content fills the
 *     remaining vertical space (e.g. a full-height table). Default
 *     (auto) lets the content's natural height drive layout.
 *
 * The default `!fluid` mode caps content at `max-w-7xl` once the
 * `@container/content` named container reaches `@7xl` (≈80rem). On a
 * 32" external display this prevents dashboard cards from stretching
 * edge-to-edge (~3000px wide cards look broken). On a laptop the cap
 * is never reached so layout is unaffected.
 *
 * The `@container/content` named container is declared on the scroll
 * wrapper in `__root.tsx`; routes don't need to set it up themselves.
 */

type MainProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean;
  fluid?: boolean;
  ref?: React.Ref<HTMLElement>;
};

export function Main({ fixed, className, fluid, ...props }: MainProps) {
  return (
    <main
      data-layout={fixed ? 'fixed' : 'auto'}
      className={cn(
        'px-4 py-6',

        // If layout is fixed, make the main container flex and grow
        fixed && 'flex grow flex-col overflow-hidden',

        // If layout is not fluid, set the max-width via container query
        !fluid && '@7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl',
        className,
      )}
      {...props}
    />
  );
}
