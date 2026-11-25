import { useRef, useState } from "react";

/**
 * Busy while the newest tracked request is in flight. An older request that settles after a newer
 * one started does not clear the flag, so switching selection mid-refresh keeps showing progress.
 */
export function useLatestRequestBusy() {
  const latest = useRef(0);
  const [busy, setBusy] = useState(false);
  const track = <Result>(request: Promise<Result>): Promise<Result> => {
    latest.current += 1;
    const mine = latest.current;
    setBusy(true);
    return request.finally(() => {
      if (latest.current === mine) setBusy(false);
    });
  };
  return [busy, track] as const;
}
