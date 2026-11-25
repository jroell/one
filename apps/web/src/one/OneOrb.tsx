import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { OneMark } from "./OneMark";
import { startOneOrb, type OneOrbRenderer, type OneOrbState } from "./oneOrbRenderer";

export type { OneOrbState };

/**
 * The One ring as a live object: it rocks slowly at rest, faces you while
 * listening, spins while the agent thinks, and swells with sound.
 * Falls back to the flat mark when WebGL is unavailable.
 */
export function OneOrb({
  state = "idle",
  levelRef,
  className,
}: {
  readonly state?: OneOrbState;
  /** Live sound level, 0 to 1. Read every frame without re-rendering. */
  readonly levelRef?: { readonly current: number };
  readonly className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<OneOrbRenderer | null>(null);
  const stateRef = useRef(state);
  const [unsupported, setUnsupported] = useState(false);

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
      onUnsupported: () => setUnsupported(true),
    });
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer?.dispose();
    };
  }, [levelRef]);

  return (
    <div className={cn("relative aspect-square", className)} data-one-orb={state}>
      {unsupported ? (
        <OneMark className="absolute inset-[18%] size-[64%]" />
      ) : (
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />
      )}
    </div>
  );
}
