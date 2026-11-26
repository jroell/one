import { useGT, useMessages } from "gt-react";
import { useInsertionEffect, useRef, useState } from "react";

/**
 * `useGT()` and `useMessages()` return new functions on every render, which defeats anything that
 * is cached on them. These return one function that calls the latest. Cache the result on the
 * locale (`useLocale()`) as well, so a language change rebuilds what was cached.
 */
function useStableFunction<T extends (...args: never[]) => unknown>(latest: T): T {
  const ref = useRef(latest);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- updates the ref during commit, before any layout effect can call the stable function
  useInsertionEffect(() => {
    ref.current = latest;
  });
  const [stable] = useState(() => ((...args: never[]) => ref.current(...args)) as T);
  return stable;
}

export function useStableGT(): ReturnType<typeof useGT> {
  return useStableFunction(useGT());
}

export function useStableMessages(): ReturnType<typeof useMessages> {
  return useStableFunction(useMessages());
}
