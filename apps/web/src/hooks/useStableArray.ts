import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import { useState } from "react";

/**
 * The same array while its elements are the same ones, so a list rebuilt on every render does not
 * read as a new value to whatever receives it (a context value, a memoized child's props).
 */
export function useStableArray<T extends ReadonlyArray<unknown>>(next: T): T {
  const [kept, setKept] = useState(next);
  if (kept === next || arrayElementsEqual(kept, next)) return kept;
  setKept(next);
  return next;
}
