import { startTransition, useEffect, useState } from "react";

/**
 * How many of `total` items to draw now: `first` at once, then `step` more on each frame until all
 * are drawn, in a transition so typing and clicks go first. Once every item has been drawn the
 * answer stays "all", however the total changes after.
 */
export function useProgressiveCount(total: number, first: number, step: number): number {
  const [count, setCount] = useState(first);
  const [all, setAll] = useState(total <= first);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- draws a long list in slices on later frames, so the first paint is not one task that mounts every row
  useEffect(() => {
    if (all) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => {
        if (count >= total) setAll(true);
        else setCount((current) => current + step);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [all, count, step, total]);
  return all ? Number.POSITIVE_INFINITY : count;
}
