import { useEffect, useLayoutEffect, useRef } from "react";

import { setToastsSuppressed } from "~/components/ui/toast";
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

/** How long the glint lasts at the button, and how far into the flight it begins. */
const GLINT_MS = 280;
const GLINT_START = 0.82;

/**
 * What stays on screen for one exit beat after voice chat ends: the dark stage fades, the ring
 * shrinks into the control that opened it, and a glint catches on that control as it lands. Leaving
 * is the arrival played backward.
 */
export function OneVoiceGhost({
  plan,
  onDone,
}: {
  readonly plan: VoiceExitPlan;
  readonly onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const glintRef = useRef<HTMLDivElement | null>(null);

  // Toasts wait until the ring has landed: one popping in over the flight would take the eye off it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the shared toast queue for the length of the exit beat
  useEffect(() => {
    setToastsSuppressed(true);
    return () => setToastsSuppressed(false);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the exit animations on the stage's last frame and removes the ghost when they end
  useLayoutEffect(() => {
    const root = rootRef.current;
    const backdrop = backdropRef.current;
    const orb = orbRef.current;
    const glint = glintRef.current;
    if (!root || !backdrop || !orb || !glint) return;
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
    // The ring stays solid until it is the size of the control, then gives way to the glint.
    const orbAnimation = orb.animate(
      [
        { transform: "none", opacity: 1 },
        { opacity: 1, offset: 0.9 },
        { transform: flight, opacity: 0 },
      ],
      { duration, easing, fill: "forwards" },
    );
    const backdropAnimation = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
      easing,
      fill: "forwards",
    });
    const glintSize = Math.max(56, Math.max(origin.width, origin.height) * 2.2);
    glint.style.width = `${glintSize}px`;
    glint.style.height = `${glintSize}px`;
    glint.style.left = `${origin.left + origin.width / 2 - glintSize / 2 - container.left}px`;
    glint.style.top = `${origin.top + origin.height / 2 - glintSize / 2 - container.top}px`;
    // The easing belongs to each half, not the whole: eased over the whole, the glint would peak and
    // be gone within the first quarter of its time.
    const ease = motionToken(root, "--ease-enter", "cubic-bezier(0.2, 0.9, 0.1, 1)");
    const glintAnimation = glint.animate(
      [
        { opacity: 0, transform: "scale(0.35)", easing: ease },
        { opacity: 1, transform: "scale(0.9)", offset: 0.3, easing: "ease-out" },
        { opacity: 0, transform: "scale(1.5)" },
      ],
      { duration: GLINT_MS, delay: duration * GLINT_START, easing: "linear", fill: "both" },
    );
    let cancelled = false;
    const finish = () => {
      if (!cancelled) onDone();
    };
    void Promise.all([
      orbAnimation.finished,
      backdropAnimation.finished,
      glintAnimation.finished,
    ]).then(finish, () => undefined);
    return () => {
      cancelled = true;
      orbAnimation.cancel();
      backdropAnimation.cancel();
      glintAnimation.cancel();
    };
  }, [plan, onDone]);

  return (
    <div ref={rootRef} aria-hidden="true" inert className="one-voice-ghost">
      <div ref={backdropRef} className="one-voice-ghost-backdrop" />
      <div ref={orbRef} className="one-voice-ghost-orb">
        <OneMark size={256} className="size-full" />
      </div>
      <div ref={glintRef} className="one-voice-ghost-glint" />
    </div>
  );
}
