import { useEffect, useState } from "react";

/** True once `active` has lasted `ms`; false again as soon as it ends. */
export function useWaitedLongerThan(active: boolean, ms: number): boolean {
  const [waited, setWaited] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that flags a wait that outlasts `ms`
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setWaited(true), ms);
    return () => {
      clearTimeout(timer);
      setWaited(false);
    };
  }, [active, ms]);
  return active && waited;
}
