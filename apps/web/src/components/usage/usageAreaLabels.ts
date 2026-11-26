/**
 * Where each end-of-line label sits so that none touches another: labels keep their order, stay at
 * least `gap` apart and stay inside `height`. A label that is pushed away from the point it names is
 * joined to it by a leader line, which the caller draws from `wanted` to the returned position.
 */
export function spreadLabels(
  wanted: readonly number[],
  gap: number,
  height: number,
): readonly number[] {
  const half = gap / 2;
  const order = wanted.map((_, index) => index).toSorted((a, b) => wanted[a]! - wanted[b]!);
  const placed = order.map((index) => Math.min(Math.max(wanted[index]!, half), height - half));
  for (let at = 1; at < placed.length; at += 1) {
    placed[at] = Math.max(placed[at]!, placed[at - 1]! + gap);
  }
  // Pushing down can run past the bottom; pull the stack back up and keep the first inside.
  for (let at = placed.length - 1; at >= 0; at -= 1) {
    const limit = at === placed.length - 1 ? height - half : placed[at + 1]! - gap;
    placed[at] = Math.min(placed[at]!, limit);
  }
  const result = Array.from({ length: wanted.length }, () => 0);
  order.forEach((index, at) => {
    result[index] = placed[at]!;
  });
  return result;
}
