import { useLayoutEffect, useRef } from "react";

import { OneMark } from "./OneMark";
import {
  EASE_EXIT_FALLBACK,
  EXIT_RATIO,
  flightTo,
  flightTransform,
  motionMs,
  motionToken,
  type VoiceExitPlan,
} from "./voiceStageMotion";

/**
 * What stays on screen for one exit beat after voice chat ends: the dark stage fades and the ring
 * flies back to the control that opened it, so leaving is the arrival played backward.
 */
export function OneVoiceGhost({
  plan,
  onDone,
}: {
  readonly plan: VoiceExitPlan;
  readonly onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the exit animations on the stage's last frame and removes the ghost when they end
  useLayoutEffect(() => {
    const root = rootRef.current;
    const orb = orbRef.current;
    if (!root || !orb) return;
    const container = root.getBoundingClientRect();
    orb.style.left = `${plan.orb.left - container.left}px`;
    orb.style.top = `${plan.orb.top - container.top}px`;
    orb.style.width = `${plan.orb.width}px`;
    orb.style.height = `${plan.orb.height}px`;
    const duration = motionMs(root, "--mo-sheet", 320) * EXIT_RATIO;
    const easing = motionToken(root, "--ease-exit", EASE_EXIT_FALLBACK);
    const origin = plan.origin ?? {
      left: container.left + container.width / 2 - 24,
      top: container.bottom - 72,
      width: 48,
      height: 48,
    };
    const flight = flightTransform(flightTo(plan.orb, origin));
    const orbAnimation = orb.animate(
      [
        { transform: "none", opacity: 1 },
        { opacity: 1, offset: 0.6 },
        { transform: flight, opacity: 0 },
      ],
      { duration, easing, fill: "forwards" },
    );
    const stageAnimation = root.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
      easing,
      fill: "forwards",
    });
    let cancelled = false;
    const finish = () => {
      if (!cancelled) onDone();
    };
    void Promise.all([orbAnimation.finished, stageAnimation.finished]).then(
      finish,
      () => undefined,
    );
    return () => {
      cancelled = true;
      orbAnimation.cancel();
      stageAnimation.cancel();
    };
  }, [plan, onDone]);

  return (
    <div ref={rootRef} aria-hidden="true" inert className="one-voice-ghost">
      <div ref={orbRef} className="one-voice-ghost-orb">
        <OneMark size={256} className="size-full" />
      </div>
    </div>
  );
}
