import { AppState } from "react-native";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * A new proposal cannot be sent for this long after the driver can see it, so a tap aimed at the
 * proposal it replaced cannot confirm one the driver has not read.
 */
export const PROPOSAL_SEND_GUARD_MS = 700;

function subscribeToAppState(listener: () => void): () => void {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}

function readAppIsActive(): boolean {
  return AppState.currentState === "active";
}

/** True only while the app is in the foreground. "inactive" (app switcher, call) is not visible. */
export function useAppIsActive(): boolean {
  return useSyncExternalStore(subscribeToAppState, readAppIsActive, readAppIsActive);
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
