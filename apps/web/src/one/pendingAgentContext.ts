/**
 * The app's notes to the model for the next message of a composer, set by the code that asked the
 * composer to send (never by anything a person types) and taken by the send that carries them.
 */
const pending = new Map<string, string>();

export function setPendingAgentContext(composerKey: string, text: string): void {
  pending.set(composerKey, text);
}

/** Takes the notes, so a later message from the same composer carries none. */
export function takePendingAgentContext(composerKey: string): string | undefined {
  const text = pending.get(composerKey);
  pending.delete(composerKey);
  return text;
}
