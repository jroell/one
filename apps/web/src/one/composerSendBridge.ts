import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";

/** How a message the app asked the composer to send went. */
export type GuidedSendResult =
  | { readonly ok: true; readonly messageId: string }
  | {
      readonly ok: false;
      readonly reason: "draft-in-the-way" | "no-provider" | "rejected" | "not-sent";
      readonly message?: string | null;
    };

/**
 * What the main composer offers other parts of the app that need it to send a message: the
 * guided conversation entry point and the quiz buttons. The composer owns the model, the thread
 * and the draft, so the message goes through the same send as one a person types.
 */
export interface ComposerSendBridge {
  readonly environmentId: EnvironmentId;
  /** The thread or draft the composer writes to. */
  readonly threadKey: string;
  readonly isDraft: boolean;
  /** The model the composer would send with right now. */
  readonly modelSelection: ModelSelection;
  /** Sends `text` as the person's message with the app's notes beside it. Never edits a draft. */
  readonly send: (input: {
    readonly text: string;
    /** Notes for the model beside the text; absent for a plain message the person chose to send. */
    readonly agentContext?: string;
  }) => Promise<GuidedSendResult>;
}

let owner: string | null = null;
let bridge: ComposerSendBridge | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function publishComposerSend(ownerKey: string, next: ComposerSendBridge): void {
  owner = ownerKey;
  bridge = next;
  emit();
}

export function retractComposerSend(ownerKey: string): void {
  if (owner !== ownerKey) return;
  owner = null;
  bridge = null;
  emit();
}

export function getComposerSend(): ComposerSendBridge | null {
  return bridge;
}

/**
 * Resolves with the bridge once the composer shows `threadKey` (and, when given, `accept` agrees
 * with it), or null if it does not in time.
 */
export function waitForComposerSend(
  threadKey: string,
  timeoutMs: number,
  accept?: (bridge: ComposerSendBridge) => boolean,
): Promise<ComposerSendBridge | null> {
  return new Promise((resolve) => {
    const settle = (value: ComposerSendBridge | null) => {
      clearTimeout(timer);
      listeners.delete(check);
      resolve(value);
    };
    const check = () => {
      if (bridge?.threadKey === threadKey && (accept?.(bridge) ?? true)) settle(bridge);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    listeners.add(check);
    check();
  });
}
