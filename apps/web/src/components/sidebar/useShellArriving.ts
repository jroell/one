import { useEffect, useState } from "react";

import { useAnyEnvironmentAwaitingShell, useQuietThreadShellsLagging } from "../../state/entities";

/** After this long without a snapshot the list stops showing an outline and says what it knows. */
const SHELL_ARRIVAL_LIMIT_MS = 8_000;

/**
 * True while the first thread list may still arrive (limited to `limitMs`), or while the list the
 * sidebar draws is a render behind a snapshot that has arrived.
 */
export function useShellArriving(limitMs = SHELL_ARRIVAL_LIMIT_MS): boolean {
  const awaiting = useAnyEnvironmentAwaitingShell();
  const lagging = useQuietThreadShellsLagging();
  const [gaveUp, setGaveUp] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer that ends the outline while mounted; the cleanup re-arms it for the next wait
  useEffect(() => {
    if (!awaiting) return;
    const timer = setTimeout(() => setGaveUp(true), limitMs);
    return () => {
      clearTimeout(timer);
      setGaveUp(false);
    };
  }, [awaiting, limitMs]);
  return (awaiting && !gaveUp) || lagging;
}
