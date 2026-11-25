import type { ContextMenuItem, KeybindingCommand } from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  ClockIcon,
  DiffIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchIcon,
  HashIcon,
  InfoIcon,
  KeyboardIcon,
  MailOpenIcon,
  MessageSquarePlusIcon,
  MicIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  SquareTerminalIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import { msg } from "gt-react";

import type { MessageResolver } from "../../i18n/messages";
import { isCommandAvailable } from "../../shortcuts/commandRegistry";
import { commandSectionFor, type CommandSectionId } from "../../shortcuts/commandSections";
import { readPaletteRunContext } from "../../shortcuts/paletteRunScope";
import { runCommandFromPalette } from "../../shortcuts/runCommand";
import { toggleShortcutsDialog } from "../shortcuts/shortcutsDialogStore";
import type { ThreadActionMenuId } from "../threadActionMenu.logic";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "../CommandPalette.logic";

type PaletteItem = CommandPaletteActionItem | CommandPaletteSubmenuItem;

interface KeybindingCommandSpec {
  readonly command: KeybindingCommand;
  readonly title: string;
  readonly keywords: ReadonlyArray<string>;
  readonly icon: LucideIcon;
  /** Only a chat has the panel, the terminal or the picker; without one the row is left out. */
  readonly needsChat: boolean;
}

/**
 * Actions that exist only as a key. A row runs the command by id through the function its scope
 * registered (see `runCommandFromPalette`), so it needs no key and shows the live one when bound.
 */
const KEYBINDING_COMMAND_SPECS: ReadonlyArray<KeybindingCommandSpec> = [
  {
    command: "terminal.toggle",
    title: msg("Toggle terminal"),
    keywords: ["terminal", "shell", "console", "drawer", "command line"],
    icon: SquareTerminalIcon,
    needsChat: true,
  },
  {
    command: "diff.toggle",
    title: msg("Toggle diff panel"),
    keywords: ["diff", "changes", "review", "git", "patch"],
    icon: DiffIcon,
    needsChat: true,
  },
  {
    command: "rightPanel.toggle",
    title: msg("Toggle right panel"),
    keywords: ["right panel", "side panel", "files", "browser", "preview"],
    icon: PanelRightIcon,
    needsChat: true,
  },
  {
    command: "threadPanel.toggle",
    title: msg("Toggle thread details"),
    keywords: ["thread details", "thread panel", "info", "tasks", "plan"],
    icon: InfoIcon,
    needsChat: true,
  },
  {
    command: "modelPicker.toggle",
    title: msg("Open model picker"),
    keywords: ["model", "provider", "switch model", "change model"],
    icon: BrainIcon,
    needsChat: true,
  },
  {
    command: "editor.openFavorite",
    title: msg("Open in editor"),
    keywords: ["editor", "vscode", "cursor", "ide", "open project"],
    icon: ExternalLinkIcon,
    needsChat: true,
  },
  {
    command: "composer.branch",
    title: msg("Switch branch"),
    keywords: ["branch", "checkout", "git", "switch"],
    icon: GitBranchIcon,
    needsChat: true,
  },
  {
    command: "composer.dictation",
    title: msg("Start or finish dictation"),
    keywords: ["dictation", "voice", "speak", "microphone", "speech"],
    icon: MicIcon,
    needsChat: true,
  },
  {
    command: "thread.previous",
    title: msg("Previous thread"),
    keywords: ["previous", "thread", "up", "back"],
    icon: ChevronUpIcon,
    needsChat: false,
  },
  {
    command: "thread.next",
    title: msg("Next thread"),
    keywords: ["next", "thread", "down", "forward"],
    icon: ChevronDownIcon,
    needsChat: false,
  },
  {
    command: "sidebar.toggle",
    title: msg("Toggle sidebar"),
    keywords: ["sidebar", "hide", "show", "projects", "threads list"],
    icon: PanelLeftIcon,
    needsChat: false,
  },
  {
    command: "view.reopenClosed",
    title: msg("Reopen closed tab"),
    keywords: ["reopen", "closed", "tab", "undo close", "restore"],
    icon: Undo2Icon,
    needsChat: false,
  },
  {
    command: "navigation.back",
    title: msg("Go back"),
    keywords: ["back", "history", "previous page"],
    icon: ArrowLeftIcon,
    needsChat: false,
  },
  {
    command: "navigation.forward",
    title: msg("Go forward"),
    keywords: ["forward", "history", "next page"],
    icon: ArrowRightIcon,
    needsChat: false,
  },
];

/**
 * A row for each command a scope has registered. One that cannot run now is left out when only
 * a chat has it, and shown disabled otherwise.
 */
export function buildKeybindingCommandItems(input: {
  readonly resolve: MessageResolver;
}): ReadonlyArray<CommandPaletteActionItem> {
  const { resolve } = input;
  const context = readPaletteRunContext();
  return KEYBINDING_COMMAND_SPECS.flatMap((spec): CommandPaletteActionItem[] => {
    const available = isCommandAvailable(spec.command, context);
    if (!available && spec.needsChat) return [];
    const title = resolve(spec.title);
    return [
      {
        kind: "action",
        value: `command:${spec.command}`,
        section: commandSectionFor(spec.command),
        title,
        searchTerms: [...spec.keywords, spec.command],
        icon: <spec.icon className={ITEM_ICON_CLASS} />,
        shortcutCommand: spec.command,
        ...(available ? {} : { disabled: true, description: resolve(msg("Not available")) }),
        run: () => runCommandFromPalette(spec.command, title),
      },
    ];
  });
}

export function buildKeyboardShortcutsItem(resolve: MessageResolver): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:keyboard-shortcuts",
    section: "help",
    title: resolve(msg("Show keyboard shortcuts")),
    searchTerms: ["keyboard shortcuts", "cheat sheet", "hotkeys", "keys", "bindings", "help"],
    icon: <KeyboardIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "shortcuts.show",
    run: async () => toggleShortcutsDialog(),
  };
}

const THREAD_ACTION_ROWS: Partial<
  Record<
    ThreadActionMenuId,
    {
      readonly keywords: ReadonlyArray<string>;
      readonly icon: LucideIcon;
      readonly shortcutCommand?: KeybindingCommand;
    }
  >
> = {
  pin: { keywords: ["pin", "favorite", "keep"], icon: PinIcon, shortcutCommand: "thread.pin" },
  unpin: {
    keywords: ["unpin", "pin", "favorite"],
    icon: PinOffIcon,
    shortcutCommand: "thread.pin",
  },
  settle: {
    keywords: ["settle", "done", "finish", "resolve"],
    icon: CircleCheckIcon,
    shortcutCommand: "thread.settle",
  },
  unsettle: {
    keywords: ["unsettle", "settle", "reopen", "undo"],
    icon: CircleCheckIcon,
    shortcutCommand: "thread.settle",
  },
  unsnooze: { keywords: ["wake", "unsnooze", "snooze"], icon: ClockIcon },
  "regenerate-title": {
    keywords: ["title", "rename", "regenerate", "retitle", "name"],
    icon: RefreshCwIcon,
    shortcutCommand: "thread.regenerateTitle",
  },
  "mark-unread": { keywords: ["unread", "mark", "inbox"], icon: MailOpenIcon },
  "new-thread-on-branch": {
    keywords: ["new thread", "branch", "same branch", "start"],
    icon: MessageSquarePlusIcon,
  },
  archive: { keywords: ["archive", "close", "remove", "hide"], icon: ArchiveIcon },
};

const THREAD_COPY_ROWS: Partial<
  Record<
    ThreadActionMenuId,
    { readonly title: string; readonly keywords: ReadonlyArray<string>; readonly icon: LucideIcon }
  >
> = {
  "copy-path": {
    title: msg("Copy workspace path"),
    keywords: ["copy", "path", "folder", "directory", "worktree"],
    icon: FolderIcon,
  },
  "copy-branch": {
    title: msg("Copy branch name"),
    keywords: ["copy", "branch", "git"],
    icon: GitBranchIcon,
  },
  "copy-thread-id": {
    title: msg("Copy thread ID"),
    keywords: ["copy", "thread", "id", "identifier"],
    icon: HashIcon,
  },
};

/**
 * The open thread's actions, taken from the same menu the breadcrumb opens, so the palette
 * and the menu offer the same rows in the same state and a row that is disabled there is
 * left out here.
 */
export function buildThreadCommandItems(input: {
  readonly menu: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>;
  readonly run: (action: ThreadActionMenuId) => Promise<void>;
  readonly resolve: MessageResolver;
}): ReadonlyArray<PaletteItem> {
  const { menu, run, resolve } = input;
  const section: CommandSectionId = "thread";
  const items: PaletteItem[] = [];
  for (const entry of menu) {
    if (entry.disabled) continue;
    const row = THREAD_ACTION_ROWS[entry.id];
    if (row) {
      items.push({
        kind: "action",
        value: `thread-action:${entry.id}`,
        section,
        title: entry.label,
        searchTerms: row.keywords,
        icon: <row.icon className={ITEM_ICON_CLASS} />,
        ...(row.shortcutCommand ? { shortcutCommand: row.shortcutCommand } : {}),
        run: () => run(entry.id),
      });
    } else if (entry.id === "snooze") {
      const presets = (entry.children ?? []).filter((child) => !child.disabled);
      items.push({
        kind: "submenu",
        value: "thread-action:snooze",
        section,
        title: entry.label,
        searchTerms: ["snooze", "later", "remind", "defer", "hide"],
        icon: <ClockIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <ClockIcon className={ADDON_ICON_CLASS} />,
        groups: [
          {
            value: "thread-snooze",
            label: resolve(msg("Snooze until")),
            items: presets.map((preset) => ({
              kind: "action" as const,
              value: `thread-action:${preset.id}`,
              title: preset.label,
              ...(preset.detail ? { description: preset.detail } : {}),
              searchTerms: [preset.label],
              icon: <ClockIcon className={ITEM_ICON_CLASS} />,
              run: () => run(preset.id),
            })),
          },
        ],
      });
    } else if (entry.id === "copy") {
      for (const child of entry.children ?? []) {
        const copy = THREAD_COPY_ROWS[child.id];
        if (!copy || child.disabled) continue;
        items.push({
          kind: "action",
          value: `thread-action:${child.id}`,
          section,
          title: resolve(copy.title),
          searchTerms: copy.keywords,
          icon: <copy.icon className={ITEM_ICON_CLASS} />,
          run: () => run(child.id),
        });
      }
    }
  }
  return items;
}
