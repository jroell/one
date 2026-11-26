/**
 * Whether a thread's timeline has painted its first screen: rows (or the empty state) laid out and
 * a frame drawn. Cleared on a thread change; the timeline root shows it as `data-first-screen-ready`.
 * `whenFirstScreenReady(key)` is for the boot handoff: it resolves when ready, or after `timeoutMs`.
 */
const ready = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setFirstScreenReady(threadKey: string, value: boolean): void {
  if (value === ready.has(threadKey)) return;
  if (value) ready.add(threadKey);
  else ready.delete(threadKey);
  emit();
}

export function isFirstScreenReady(threadKey: string): boolean {
  return ready.has(threadKey);
}

export function whenFirstScreenReady(threadKey: string, timeoutMs = 4000): Promise<void> {
  if (ready.has(threadKey)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const listener = () => {
      if (ready.has(threadKey)) done();
    };
    function done() {
      clearTimeout(timer);
      listeners.delete(listener);
      resolve();
    }
    listeners.add(listener);
  });
}
