import { startTransition, useEffect, useState } from "react";

/**
 * How many of `total` items to draw now: `first` at once, then `step` more on each frame until all
 * are drawn, in a transition so typing and clicks go first. Rows already drawn stay drawn: once the
 * count has reached the total the answer is "all", and a list that grows past what was drawn (the
 * first snapshot after a cold start, a second environment) is drawn in slices again.
 */
export function useProgressiveCount(total: number, first: number, step: number): number {
  const [count, setCount] = useState(first);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- draws a long list in slices on later frames, so the first paint is not one task that mounts every row
  useEffect(() => {
    if (count >= total) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => setCount((current) => current + step));
    });
    return () => cancelAnimationFrame(frame);
  }, [count, step, total]);
  return count >= total ? Number.POSITIVE_INFINITY : count;
}
