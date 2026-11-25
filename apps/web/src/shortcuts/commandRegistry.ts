import type { KeybindingCommand } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/** What a palette row knows that a key press does not. A key passes none. */
export interface CommandRunContext {
  /**
   * The element that had focus when the palette opened, or null when nothing did. Handlers that
   * depend on where the user was (a focused terminal, the editor to dictate into) read it.
   */
  readonly opener: Element | null;
}

export interface RegisteredCommand {
  /** The function the command's key calls. Returns false when it declined and did nothing. */
  readonly run: (context?: CommandRunContext) => boolean | void;
  /**
   * Whether `run` would act now. Read when a row is built and again before it runs, so it must
   * not call an effect event: the palette reads it during render.
   */
  readonly canRun?: (context?: CommandRunContext) => boolean;
}

export type RegisteredCommands = Partial<Record<KeybindingCommand, RegisteredCommand>>;

// Newest registration last, like the key dispatcher's scopes.
const registrations = new Map<KeybindingCommand, RegisteredCommand[]>();
const listeners = new Set<() => void>();
let version = 0;

function announceChange(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Registers the handlers a scope already runs for its keys, so a palette row calls the same
 * function a key press does. A scope registers on mount and calls the result on unmount.
 */
export function registerCommandHandlers(commands: RegisteredCommands): () => void {
  const added: Array<readonly [KeybindingCommand, RegisteredCommand]> = [];
  for (const [command, registration] of Object.entries(commands) as Array<
    [KeybindingCommand, RegisteredCommand]
  >) {
    const list = registrations.get(command) ?? [];
    list.push(registration);
    registrations.set(command, list);
    added.push([command, registration]);
  }
  announceChange();
  return () => {
    for (const [command, registration] of added) {
      const list = registrations.get(command);
      const index = list?.lastIndexOf(registration) ?? -1;
      if (list && index !== -1) list.splice(index, 1);
      if (list?.length === 0) registrations.delete(command);
    }
    announceChange();
  };
}

/** The newest registration that can run now; one that declines falls through to the next. */
function resolveRegistration(
  command: KeybindingCommand,
  context: CommandRunContext | undefined,
): RegisteredCommand | null {
  const list = registrations.get(command);
  if (!list) return null;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const registration = list[index];
    if (registration && registration.canRun?.(context) !== false) return registration;
  }
  return null;
}

export function isCommandAvailable(
  command: KeybindingCommand,
  context?: CommandRunContext,
): boolean {
  return resolveRegistration(command, context) !== null;
}

/** Runs the command's newest runnable registration; false when none can run or it declined. */
export function runRegisteredCommand(
  command: KeybindingCommand,
  context?: CommandRunContext,
): boolean {
  const list = registrations.get(command);
  if (!list) return false;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const registration = list[index];
    if (!registration || registration.canRun?.(context) === false) continue;
    if (registration.run(context) !== false) return true;
  }
  return false;
}

/** Changes whenever a scope registers or unregisters, so a row list can rebuild. */
export function useCommandRegistryVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}
