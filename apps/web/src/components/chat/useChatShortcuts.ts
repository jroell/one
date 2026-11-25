import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { resolveChatShortcutCommand, type ShortcutMatchContext } from "../../keybindings";
import { isTerminalCloseConfirmPending } from "../../lib/terminalCloseConfirm";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../../lib/terminalCloseShortcut";
import { isInSideChatPane } from "../../lib/sideChatPane";
import { getTerminalFocusOwner, type TerminalFocusOwner } from "../../lib/terminalFocus";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { registerCommandHandlers, type RegisteredCommands } from "../../shortcuts/commandRegistry";
import type { BranchToolbarHandle } from "../BranchToolbar";
import { shouldTypeToFocusComposer } from "./composerFocusRedirect";
import { composerShortcutCommands } from "./composerShortcuts";

/** What a handler reads of the key that ran it; a palette row, which has no key, passes none. */
type ShortcutKey = Pick<KeyboardEvent, "repeat" | "target">;

const NO_KEY: ShortcutKey = { repeat: false, target: null };

/** Returning false lets the key through, except for cycling while a terminal owns focus. */
type ChatShortcutHandler = (context: {
  readonly event: ShortcutKey;
  readonly terminalFocusOwner: TerminalFocusOwner | null;
}) => boolean | void;

/**
 * A handler with a check for whether it would act now, so a palette row can say so first.
 * A key still reaches `run`, which keeps its own early returns.
 */
interface ChatShortcutDefinition {
  readonly run: ChatShortcutHandler;
  readonly canRun: () => boolean;
}

export type ChatShortcutCommands = Partial<
  Record<KeybindingCommand, ChatShortcutHandler | ChatShortcutDefinition>
>;

/** The one function a key and a palette row both call. */
const handlerOf = (entry: ChatShortcutHandler | ChatShortcutDefinition): ChatShortcutHandler =>
  typeof entry === "function" ? entry : entry.run;

/** Window-level commands the main chat still runs while focus is in its side chat pane. */
const SIDE_CHAT_PANE_COMMANDS: ReadonlySet<KeybindingCommand> = new Set([
  "rightPanel.toggle",
  "rightPanel.close",
  "rightPanel.toggleMaximized",
]);

interface ChatShortcutsInput {
  readonly enabled: boolean;
  /**
   * A side chat inside another chat leaves the window to the outer chat. It listens on its
   * side chat pane, around `composerElement`: find and Escape closing it anywhere in the pane,
   * composer chords only inside `composerElement`.
   */
  readonly embedded?: boolean;
  readonly composerElement?: HTMLElement | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly scriptKeybindings: ResolvedKeybindingsConfig;
  readonly getShortcutContext: (target: EventTarget | null) => ShortcutMatchContext & {
    readonly modelPickerOpen: boolean;
  };
  readonly threadFindActive: boolean;
  /** Takes type-to-focus keys and the composer and branch toolbar chords. */
  readonly composerRef: ComposerHandleRef;
  readonly branchToolbarRef: { readonly current: BranchToolbarHandle | null };
  readonly closeThreadFind: () => void;
  readonly commands: ChatShortcutCommands;
  /** Handles commands not in `commands`, such as project scripts. */
  readonly fallback: (command: KeybindingCommand) => ChatShortcutHandler | undefined;
}

function canRunChatCommand(input: ChatShortcutsInput, command: KeybindingCommand): boolean {
  if (!input.enabled) return false;
  const entry =
    input.commands[command] ??
    composerShortcutCommands(input.composerRef, input.branchToolbarRef)[command];
  return entry !== undefined && (typeof entry === "function" || entry.canRun());
}

/**
 * The chat's window keyboard shortcuts, plus Escape closing thread find.
 * Listeners attach once; the effect events read the latest input, so handlers
 * act on the current render without re-registering on every change.
 */
export function useChatShortcuts(input: ChatShortcutsInput) {
  const embedded = input.embedded === true;
  const composerElement = embedded ? (input.composerElement ?? null) : null;
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest("[data-keybinding-capture]")) {
      return;
    }
    const { keybindings } = input;
    if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (input.threadFindActive && event.key === "Escape") return;
    if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (!input.enabled || isCommandPaletteOpen()) return;
    const inSideChatPane = isInSideChatPane(event.target);
    const terminalFocusOwner = getTerminalFocusOwner();
    if (event.defaultPrevented && terminalFocusOwner === null) return;
    const shortcutContext = input.getShortcutContext(event.target);

    if (
      !inSideChatPane &&
      !shortcutContext.terminalFocus &&
      !shortcutContext.modelPickerOpen &&
      shouldTypeToFocusComposer(event) &&
      input.composerRef.current?.insertTextAtEnd(event.key) === true
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const command = resolveChatShortcutCommand(event, keybindings, input.scriptKeybindings, {
      context: shortcutContext,
    });
    if (!command || (inSideChatPane && !SIDE_CHAT_PANE_COMMANDS.has(command))) return;
    const entry =
      input.commands[command] ??
      composerShortcutCommands(input.composerRef, input.branchToolbarRef)[command];
    const run = entry ? handlerOf(entry) : input.fallback(command);
    if (!run) return;
    const handled = run({ event, terminalFocusOwner });
    if (
      handled === false &&
      (terminalFocusOwner === null ||
        (command !== "terminal.previous" && command !== "terminal.next"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  });
  const dismissFind = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      !input.threadFindActive ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen() ||
      isInSideChatPane(event.target) !== embedded
    )
      return;
    const context = input.getShortcutContext(event.target);
    if (context.terminalFocus || context.previewFocus || context.modelPickerOpen) return;
    // The narrow right panel sheet closes on Escape and ignores defaultPrevented.
    event.preventDefault();
    event.stopPropagation();
    input.closeThreadFind();
  });
  const handleSideChatShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isCommandPaletteOpen()) return;
    const command = resolveChatShortcutCommand(event, input.keybindings, input.scriptKeybindings, {
      context: input.getShortcutContext(event.target),
    });
    let run: ChatShortcutHandler | undefined;
    if (command === "chat.find") {
      const entry = input.commands[command];
      run = entry ? handlerOf(entry) : undefined;
    } else if (command && event.target instanceof Node && composerElement?.contains(event.target)) {
      const entry = composerShortcutCommands(input.composerRef, input.branchToolbarRef)[command];
      run = entry ? handlerOf(entry) : undefined;
    }
    if (!run || run({ event, terminalFocusOwner: null }) === false) return;
    event.preventDefault();
    event.stopPropagation();
  });
  // A palette row calls the same handler a key does, with no key and no terminal focus.
  const runRegistered = useEffectEvent((command: KeybindingCommand) => {
    const entry =
      input.commands[command] ??
      composerShortcutCommands(input.composerRef, input.branchToolbarRef)[command];
    return entry ? handlerOf(entry)({ event: NO_KEY, terminalFocusOwner: null }) : false;
  });
  // The palette asks this while it renders, where an effect event may not be called, so it reads
  // the latest input from a ref instead.
  const latestInput = useRef(input);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the ref that canRun reads during another component's render in step with this render's input
  useLayoutEffect(() => {
    latestInput.current = input;
  });
  const registeredCommandIds = useEffectEvent(
    () =>
      [
        ...Object.keys(input.commands),
        ...Object.keys(composerShortcutCommands(input.composerRef, input.branchToolbarRef)),
      ] as KeybindingCommand[],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the chat's commands by id while it is mounted, so palette rows run the same handlers as its keys
  useEffect(() => {
    if (embedded) return;
    const commands = registeredCommandIds();
    const registered: RegisteredCommands = {};
    for (const command of new Set(commands)) {
      registered[command] = {
        run: () => runRegistered(command),
        canRun: () => canRunChatCommand(latestInput.current, command),
      };
    }
    return registerCommandHandlers(registered);
  }, [embedded]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- attaches keydown listeners for chat shortcuts and find dismissal: on the window, or on an embedded chat's side chat pane
  useEffect(() => {
    const target: Pick<HTMLElement, "addEventListener" | "removeEventListener"> | null = embedded
      ? (composerElement?.closest<HTMLElement>("[data-side-chat-pane]") ?? null)
      : window;
    if (!target) return;
    const onKeyDownCapture = (event: KeyboardEvent) =>
      embedded ? handleSideChatShortcut(event) : handleShortcut(event);
    const onKeyDown = (event: KeyboardEvent) => dismissFind(event);
    target.addEventListener("keydown", onKeyDownCapture, true);
    target.addEventListener("keydown", onKeyDown);
    return () => {
      target.removeEventListener("keydown", onKeyDownCapture, true);
      target.removeEventListener("keydown", onKeyDown);
    };
  }, [composerElement, embedded]);
}
