import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { OneMark } from "./OneMark";
import { startOneOrb, type OneOrbRenderer, type OneOrbState } from "./oneOrbRenderer";

export type { OneOrbState };

/** How long the ring takes to ignite in the opening. */
export const OPENING_SECONDS = 3.2;

/**
 * The One ring as a live object: it rocks slowly at rest, faces you while
 * listening, spins while the agent thinks (or, as "waiting", holds edge-on while one sweep of
 * light crosses it), and swells with sound.
 * Shows the flat mark when WebGL is unavailable, and while a lost context waits to be restored.
 */
export function OneOrb({
  state = "idle",
  levelRef,
  glowLevelRef,
  opening = false,
  className,
}: {
  /** Plays the opening: the ring ignites out of the dark. Set once at mount. */
  readonly opening?: boolean;
  readonly state?: OneOrbState;
  /** Live sound level, 0 to 1. Read every frame without re-rendering. */
  readonly levelRef?: { readonly current: number };
  /**
   * Rim and halo level, 0 to 1, read every frame. It lights the ring and never changes its
   * shape, unlike `levelRef`, which swells it.
   */
  readonly glowLevelRef?: { readonly current: number };
  readonly className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<OneOrbRenderer | null>(null);
  const stateRef = useRef(state);
  // "lost" is a GPU context the browser may restore; "unsupported" is final.
  const [availability, setAvailability] = useState<"live" | "lost" | "unsupported">("live");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the new state to the WebGL render loop, which runs outside React
  useEffect(() => {
    stateRef.current = state;
    rendererRef.current?.wake();
  }, [state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the WebGL context and its frame loop for as long as the canvas is mounted
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = startOneOrb(canvas, {
      getState: () => stateRef.current,
      getLevel: () => levelRef?.current ?? 0,
      getGlowLevel: () => glowLevelRef?.current ?? 0,
      onUnsupported: () => setAvailability("unsupported"),
      onContextLost: () => setAvailability((current) => (current === "live" ? "lost" : current)),
      onContextRestored: () =>
        setAvailability((current) => (current === "lost" ? "live" : current)),
      ...(opening ? { openingSeconds: OPENING_SECONDS } : {}),
    });
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer?.dispose();
    };
  }, [glowLevelRef, levelRef, opening]);

  return (
    <div className={cn("relative aspect-square", className)} data-one-orb={state}>
      {/* The canvas stays mounted under the fallback: a lost context comes back to the same canvas. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn("absolute inset-0 size-full", availability !== "live" && "invisible")}
      />
      {availability !== "live" ? (
        <OneMark className="absolute inset-0 size-full" size={128} />
      ) : null}
    </div>
  );
}
