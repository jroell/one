import { AppState } from "react-native";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * A new proposal cannot be sent for this long after the driver can see it, so a tap aimed at the
 * proposal it replaced cannot confirm one the driver has not read.
 */
export const PROPOSAL_SEND_GUARD_MS = 700;

/**
 * Whether the app is in the foreground and, on Android, holds window focus. Android keeps
 * `AppState` "active" while the notification shade or another window covers the app, and reports
 * that only as `blur` and `focus`. iOS has no such events, so it reads `AppState.currentState`.
 */
function createAppVisibilityStore() {
  let windowBlurred = false;
  return {
    subscribe(listener: () => void): () => void {
      // Android reports window focus only through these events. iOS never emits them, so there the
      // listeners stay silent and visibility comes from `AppState.currentState` alone.
      const subscriptions = [
        AppState.addEventListener("change", listener),
        AppState.addEventListener("blur", () => {
          windowBlurred = true;
          listener();
        }),
        AppState.addEventListener("focus", () => {
          windowBlurred = false;
          listener();
        }),
      ];
      return () => {
        for (const subscription of subscriptions) subscription.remove();
      };
    },
    read(): boolean {
      return AppState.currentState === "active" && !windowBlurred;
    },
  };
}

/** True only while the app is in the foreground. "inactive" (app switcher, call) is not visible. */
export function useAppIsActive(): boolean {
  const [store] = useState(createAppVisibilityStore);
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}

/**
 * True once `PROPOSAL_SEND_GUARD_MS` of uninterrupted visibility has passed. The countdown is a
 * timer that starts when `visible` becomes true, so it ignores the wall clock. Hiding the card
 * disarms it in the same render, and showing it again starts the full guard over.
 */
export function useProposalSendGuard(visible: boolean): boolean {
  const [state, setState] = useState({ visible, armed: false });
  if (state.visible !== visible) setState({ visible, armed: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- arms the guard from a timer that runs only while the card is visible
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(
      () => setState((current) => (current.visible ? { ...current, armed: true } : current)),
      PROPOSAL_SEND_GUARD_MS,
    );
    return () => clearTimeout(timer);
  }, [visible]);

  return visible && state.visible && state.armed;
}
