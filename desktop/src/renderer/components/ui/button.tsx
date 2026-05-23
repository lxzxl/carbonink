import { Slot } from '@radix-ui/react-slot';
import { cn } from '@renderer/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

/**
 * Native-feel notes (skill `06-native-conventions.md`):
 * - `:active` rule gives the button a real *pressed* state distinct from
 *   hover (NSButton has both; many web-only designs only style hover).
 * - Hover treatment is subtle. Filled primary darkens; outline tints the
 *   border + bg lightly. Native buttons do NOT change background fully
 *   on hover.
 * - Reserve `default` (filled primary) for the ONE most important action
 *   on each page. Secondary / tertiary actions should use `outline` or
 *   `secondary`. The questionnaire detail page's 4-button bar is the
 *   counter-example we just fixed.
 */
// Focus indicator — minimal, ring-less.
//
// Iteration history:
//   1. Original: `focus-visible:ring-2` — harsh 2px solid ring (user
//      reported the "ugly 边框" on SidebarTrigger).
//   2. Then: switched to shadcn-admin's `focus-visible:ring-[3px]
//      ring-ring border-ring` (3px green halo). User: still 难看,
//      "删除" (just remove the ring entirely).
//   3. Now: NO ring halo at all. Focus communicated via:
//        - `focus-visible:border-ring` — outlined buttons (incl.
//          SidebarTrigger) shift their existing border to the ring
//          color. Subtle, native-feeling.
//        - `focus-visible:bg-foreground/8` on the `ghost` variant
//          (which has no border to recolor) — mimics the hover bg so
//          keyboard users still see focus. WCAG 2.4.7 satisfied.
//   `outline-none` kills the browser's default 2px blue outline; the
//   above rules replace it.
const buttonVariants = cva(
  // `whitespace-nowrap` is critical for CJK locales — Chinese labels
  // like "保存" (2 chars) will wrap one character per line when the
  // flex parent compresses widths. Without nowrap, "保存" renders as
  // a vertical "保 / 存" stack inside the button.
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:border-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95',
        outline: 'border border-border bg-card/40 text-foreground hover:bg-card/80 active:bg-card',
        secondary: 'bg-foreground/8 text-foreground hover:bg-foreground/12 active:bg-foreground/15',
        ghost: 'hover:bg-foreground/5 active:bg-foreground/8 focus-visible:bg-foreground/8',
        destructive:
          'bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15 active:bg-destructive/20',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6',
        // Square icon-button used by shadcn's Sidebar (`SidebarTrigger`).
        // h-9 / w-9 + no padding gives a 36×36 hit target. The inner
        // <svg> sizes via lucide's default `size-4`.
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';
