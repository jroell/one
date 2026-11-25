import { Platform } from "react-native";
import { useCallback, useEffect, useState } from "react";

/** The slide-down of a closing sheet is still on screen for about this long on both platforms. */
export const SHEET_DISMISS_SETTLE_MS = 600;

/**
 * Longest an iOS sheet stays covered while waiting for `Modal.onDismiss`. It only runs when that
 * callback never arrives, so it is longer than the animation it stands in for.
 */
export const SHEET_DISMISS_FALLBACK_MS = 1500;

/**
 * True while a sheet hides the stage: from the moment it opens until its close animation has
 * finished. `open` flips to false before React Native finishes animating the Modal away, so the
 * sheet stays covered until `onDismiss` fires (iOS only, when `hasNativeDismiss` is true) or the
 * settle interval has passed (Android, and any sheet that has no `onDismiss` to pass on).
 */
export function useSheetCoverage(
  open: boolean,
  hasNativeDismiss: boolean,
): { readonly covered: boolean; readonly onDismiss: () => void } {
  const [state, setState] = useState({ open, dismissing: false });
  if (state.open !== open) setState({ open, dismissing: state.open && !open });

  const dismissing = state.dismissing && !open;
  const waitsForNativeDismiss = hasNativeDismiss && Platform.OS === "ios";
  const settleMs = waitsForNativeDismiss ? SHEET_DISMISS_FALLBACK_MS : SHEET_DISMISS_SETTLE_MS;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the dismissing state from a timer that runs only while the sheet is closing
  useEffect(() => {
    if (!dismissing) return;
    const timer = setTimeout(
      () => setState((current) => (current.open ? current : { ...current, dismissing: false })),
      settleMs,
    );
    return () => clearTimeout(timer);
  }, [dismissing, settleMs]);

  const onDismiss = useCallback(() => {
    if (!waitsForNativeDismiss) return;
    setState((current) => (current.dismissing ? { ...current, dismissing: false } : current));
  }, [waitsForNativeDismiss]);

  return { covered: open || dismissing, onDismiss };
}
