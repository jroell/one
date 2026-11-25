import type { ComposerHandleRef } from "../../composerHandleContext";
import type { BranchToolbarHandle } from "../BranchToolbar";
import type { ChatComposerHandle } from "./ChatComposer";
import type { ChatShortcutCommands } from "./useChatShortcuts";

/** Chords that open or step the composer's controls and its branch toolbar. Held keys do not repeat them. */
export function composerShortcutCommands(
  composerRef: ComposerHandleRef,
  branchToolbarRef: { readonly current: BranchToolbarHandle | null },
): ChatShortcutCommands {
  // Without a mounted composer or branch toolbar the chord does nothing, so a row for it is unavailable.
  const composerMounted = () => composerRef.current !== null;
  const branchToolbarMounted = () => branchToolbarRef.current !== null;
  const openControl = (control: Parameters<ChatComposerHandle["openControl"]>[0]) => ({
    run: ({ event }: { readonly event: { readonly repeat: boolean } }) => {
      if (!event.repeat) composerRef.current?.openControl(control);
    },
    canRun: composerMounted,
  });
  return {
    "modelPicker.toggle": {
      run: ({ event }) => {
        if (!event.repeat) composerRef.current?.toggleModelPicker();
      },
      canRun: composerMounted,
    },
    "composer.increaseEffort": {
      run: ({ event }) => {
        if (!event.repeat) composerRef.current?.stepReasoningEffort(1);
      },
      canRun: composerMounted,
    },
    "composer.decreaseEffort": {
      run: ({ event }) => {
        if (!event.repeat) composerRef.current?.stepReasoningEffort(-1);
      },
      canRun: composerMounted,
    },
    "composer.host": openControl("composer.host"),
    "composer.effort": openControl("composer.effort"),
    "composer.mode": openControl("composer.mode"),
    "composer.workspace": openControl("composer.workspace"),
    "composer.branch": {
      run: ({ event }) => {
        if (!event.repeat) branchToolbarRef.current?.openBranchPicker();
      },
      canRun: branchToolbarMounted,
    },
    "composer.previousWorktree": {
      run: ({ event }) => {
        if (!event.repeat) branchToolbarRef.current?.usePreviousWorktree();
      },
      canRun: branchToolbarMounted,
    },
  } satisfies ChatShortcutCommands;
}
