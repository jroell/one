import type { LimitPace } from "@t3tools/shared/usageLimits";
import { T, useGT } from "gt-react";
import type { CSSProperties } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { behindPaceGap, meterState } from "./usageMeterState";

/**
 * A recessed channel with a glossy capsule for the share still left, and a notch where even
 * spending would be. When spending is ahead of the window, a quiet hatched stretch inside the channel spans
 * the fill's end to the notch. The fill slides in once on mount and eases to a new value on refresh.
 */
export function LimitMeter({
  remaining,
  timeLeft,
  pace,
  color,
  label,
}: {
  readonly remaining: number;
  readonly timeLeft: number | null;
  readonly pace: LimitPace | null;
  readonly color: string;
  readonly label: string;
}) {
  const gt = useGT();
  const state = meterState(remaining);
  const gap = behindPaceGap(remaining, timeLeft, pace);
  const style = {
    "--usage-accent": color,
    "--usage-shift": `${remaining - 100}%`,
  } as CSSProperties;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={remaining}
      aria-valuetext={gt("{remaining}% left", { remaining })}
      className="usage-meter"
      data-state={state}
      style={style}
    >
      <div className="usage-meter-channel">
        {gap ? (
          <span
            aria-hidden
            className="usage-meter-gap"
            style={{ left: `${gap.from}%`, width: `${gap.to - gap.from}%` }}
          />
        ) : null}
        {remaining > 0 ? <span aria-hidden className="usage-meter-fill" /> : null}
      </div>
      {state === "critical" && remaining > 0 ? (
        <span aria-hidden className="usage-meter-halo">
          <span className="usage-meter-glow" style={{ width: `${remaining}%` }} />
        </span>
      ) : null}
      {timeLeft === null ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span aria-hidden className="usage-meter-marker" style={{ left: `${timeLeft}%` }} />
            }
          >
            <span className="usage-meter-caret" />
            <span className="usage-meter-notch" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground">
                {gt("Even pace: {timeLeft}% left by now", { timeLeft })}
              </span>
              <span className="text-muted-foreground">
                <T>The line is where even spending would be.</T>
              </span>
              {gap ? (
                <span className="text-warning-foreground">
                  {gt("Behind even pace by {gap}%", { gap: gap.to - gap.from })}
                </span>
              ) : null}
            </div>
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
