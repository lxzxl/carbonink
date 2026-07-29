import { Button } from '@renderer/components/ui/button';
import * as m from '@renderer/paraglide/messages';
import type { TooltipRenderProps } from 'react-joyride';

/**
 * The guidance tooltip. Replaces react-joyride's default card wholesale so
 * the tour reads as part of the app rather than as a bolted-on library:
 * popover surface, 1px border, our Button hierarchy (one filled primary,
 * everything else outline/ghost), no colored accent stripe, no progress
 * bar animation.
 *
 * `backProps` / `primaryProps` / `skipProps` carry joyride's onClick +
 * a11y attributes; they must be spread onto real buttons.
 */
export function TourTooltip({
  backProps,
  index,
  isLastStep,
  primaryProps,
  size,
  skipProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      data-testid="guidance-tooltip"
      className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      {step.title && <div className="text-sm font-semibold">{step.title}</div>}
      <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.content}</div>
      <div className="mt-4 flex items-center gap-2">
        {size > 1 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {/* "2 / 3" reads as a fraction to a screen reader; the spelled
             * -out position is announced instead. */}
            <span className="sr-only">
              {m.guidance_progress({ current: index + 1, total: size })}
            </span>
            <span aria-hidden="true">
              {index + 1} / {size}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!isLastStep && (
            <Button type="button" variant="ghost" size="sm" {...skipProps}>
              <span className="whitespace-nowrap">{m.guidance_skip()}</span>
            </Button>
          )}
          {index > 0 && (
            <Button type="button" variant="outline" size="sm" {...backProps}>
              <span className="whitespace-nowrap">{m.guidance_back()}</span>
            </Button>
          )}
          <Button type="button" size="sm" {...primaryProps}>
            <span className="whitespace-nowrap">
              {isLastStep ? m.guidance_done() : m.guidance_next()}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
