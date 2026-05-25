import { LocaleToggle } from '@renderer/components/LocaleToggle';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { ReactNode } from 'react';

/**
 * Onboarding wizard shell — handles the chrome that's identical on every
 * step so each step component can focus on its fields.
 *
 * Layout decisions:
 *
 *   1. Vertical centering. With the global app chrome stripped (sidebar +
 *      header + license banner all suppressed for `/onboarding/*` — see
 *      `__root.tsx`), the form was pinned to the top-left of the viewport
 *      with vast empty space below. A centered card creates the focused,
 *      modal-like feel of an installer / setup assistant.
 *
 *   2. Progress dots. 5 segments at top — current step lit (primary), past
 *      steps muted-but-filled, future steps outlined. Communicates "where
 *      am I, how much is left" without taking a full progress bar's vertical
 *      space.
 *
 *   3. Eyebrow + title + subtitle. Replaces the old duplicate `引导设置`
 *      h1 + step h2 pair. The eyebrow ("Step 1 of 5") is the contextual
 *      orientation cue; the h1 is the step name (the user's actual current
 *      task); the subtitle explains intent. Three lines of decreasing visual
 *      weight create clear hierarchy with space alone — no color/size
 *      gymnastics needed.
 *
 *   4. Card frame. `border + bg-card + rounded-lg + shadow-sm` gives the
 *      form a defined edge against the empty backdrop. Without the frame
 *      the centered form just looks lost.
 *
 *   5. Footer separator. The previous `pt-2` between fields and `下一步`
 *      button left no visual anchor — buttons floated. A `border-t` plus
 *      `pt-4` after the body anchors the action area.
 *
 * Slot model:
 *   - `title` / `subtitle`: rendered in the shell header.
 *   - `children`: form body (fields).
 *   - `footer`: back / next buttons. Shell adds the separator + padding.
 */

const TOTAL_STEPS = 5;

export interface WizardShellProps {
  step: number;
  title: string;
  subtitle?: string | undefined;
  children: ReactNode;
  footer: ReactNode;
}

export function WizardShell({ step, title, subtitle, children, footer }: WizardShellProps) {
  // Outer wrapper is plain — vertical centering is owned by `__root.tsx`'s
  // onboarding branch (where the height is known). This component just
  // sets the wizard's max-width and stacks dots + card.
  return (
    <div className="w-full max-w-xl">
      {/* Top chrome row: progress dots on the left, language toggle on
       * the right. Same row keeps the wizard "skin" compact — if the
       * toggle sat above the dots, every step would gain an extra band
       * of empty space. The toggle is present on every step so a user
       * whose `navigator.language` was mis-detected can recover without
       * waiting until the end of onboarding to find /settings. */}
      <div className="flex items-center justify-between gap-3">
        <ProgressDots current={step} total={TOTAL_STEPS} />
        <LocaleToggle />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card shadow-sm">
        <header className="px-8 pt-8 pb-6">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {m.onboarding_eyebrow({ current: String(step), total: String(TOTAL_STEPS) })}
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
          )}
        </header>

        {/* Body — content padding matches header (px-8) for vertical
         * alignment. `pb-6` separates body from footer. */}
        <div className="px-8 pb-6">{children}</div>

        <footer className="border-t border-border px-8 py-4">{footer}</footer>
      </div>
    </div>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      className="flex items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const isPast = stepNum < current;
        const isCurrent = stepNum === current;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length progress, no reordering
            key={i}
            aria-hidden="true"
            className={cn(
              'h-1.5 rounded-full transition-colors',
              // Current step segment is wider — emphasizes "you are here"
              // without color contrast alone (helps a11y, helps anywhere
              // the palette renders thin).
              isCurrent ? 'w-8 bg-primary' : 'w-6',
              isPast && 'bg-primary/60',
              !isPast && !isCurrent && 'bg-border',
            )}
          />
        );
      })}
    </div>
  );
}
