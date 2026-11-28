import {
  STATIC_KEYBINDING_COMMANDS,
  type ClientSettings,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
  US_SHIFTED_TO_UNSHIFTED_KEYS,
} from "@t3tools/shared/keybindings";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import {
  formatShortcutLabel,
  shortcutConflictKey,
  shortcutForContext,
  shortcutKeyFromEvent,
} from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import { METRIC_OPTIONS, WINDOW_OPTIONS } from "../usage/usageShortcuts";

// Rank every usage command; mixing rank and alphabetical comparisons makes order input-dependent.
const usageCommandOrder = new Map<KeybindingCommand, number>(
  [
    "usage.open" as const,
    ...[...METRIC_OPTIONS, ...WINDOW_OPTIONS].map((option) => option.command),
  ].map((command, index) => [command, index]),
);

const firstUsageCommand = METRIC_OPTIONS[0].command;

/** Commands that come as a pair: the second sorts right after the first, not by its own name. */
const PAIR_FOLLOWERS: ReadonlyMap<string, string> = new Map([
  ["thread.previous", "thread.next"],
  ["workspace.focusPrevious", "workspace.focusNext"],
  ["modelPicker.previousProvider", "modelPicker.nextProvider"],
  ["composer.decreaseEffort", "composer.increaseEffort"],
  ["preview.zoomOut", "preview.zoomIn"],
  ["navigation.forward", "navigation.back"],
]);

/** The command a paired command is listed right after ("thread.next" for "thread.previous"). */
function commandPairLeader(command: KeybindingCommand): KeybindingCommand | null {
  return (PAIR_FOLLOWERS.get(String(command)) as KeybindingCommand | undefined) ?? null;
}

/** The sort key of a command in a list read as groups of related actions: pairs sit together. */
export function commandSortKey(command: KeybindingCommand): string {
  const leader = commandPairLeader(command);
  return leader === null ? String(command) : `${leader}~`;
}

function compareCommands(
  left: KeybindingCommand,
  right: KeybindingCommand,
  key: (command: KeybindingCommand) => string,
): number {
  const leftRank = usageCommandOrder.get(left);
  const rightRank = usageCommandOrder.get(right);
  if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
  return key(leftRank === undefined ? left : firstUsageCommand).localeCompare(
    key(rightRank === undefined ? right : firstUsageCommand),
  );
}

export type KeybindingSource = "Default" | "Custom" | "Project";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly isUnassigned: boolean;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule;
  readonly conflicts: ReadonlyArray<string>;
  readonly previewLabels: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = [
  "terminalFocus",
  "terminalOpen",
  "previewOpen",
  "composerEmpty",
  "isWeb",
  "isDesktop",
  "true",
  "false",
] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

export const DEFAULT_WHEN_VARIABLE =
  [...DEFAULT_WHEN_VARIABLES].find(
    (identifier) => identifier !== "true" && identifier !== "false",
  ) ?? "terminalFocus";
const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);

export function shortcutToKeybindingParts(shortcut: KeybindingShortcut): ReadonlyArray<string> {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts;
}

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  return shortcutToKeybindingParts(shortcut).join("+");
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

export function whenNodeRemoveLabel(
  node: KeybindingWhenNode,
  depth: number,
  resolve: MessageResolver = m,
): string {
  if (depth === 0) return resolve(msg("Clear all conditions"));
  if (node.type === "identifier" || (node.type === "not" && node.node.type === "identifier")) {
    return resolve(msg("Remove condition"));
  }
  return resolve(msg("Remove group and its conditions"));
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
  resolve: MessageResolver = m,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: resolve(msg("Use variables with !, &&, ||, and parentheses.")),
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  if (String(binding.command).startsWith("script.")) {
    const source: KeybindingSource = "Project";
    return source;
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  const source: KeybindingSource = isDefault ? "Default" : "Custom";
  return source;
}

function defaultBindingForBinding(
  binding: ResolvedKeybindingRule,
  keybindings: ResolvedKeybindingsConfig,
): ResolvedKeybindingRule | undefined {
  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isBound = (entry: ResolvedKeybindingRule) =>
    keybindings.some(
      (other) =>
        other.command === entry.command &&
        shortcutToKeybindingInput(other.shortcut) === shortcutToKeybindingInput(entry.shortcut) &&
        [whenAstToExpression(entry.whenAst), "false"].includes(whenAstToExpression(other.whenAst)),
    );
  // An edited row does not record which default it replaced; a default the command still has,
  // or that is unassigned, cannot be it.
  const findDefault = (matches: (entry: ResolvedKeybindingRule) => boolean) =>
    DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => matches(entry) && !isBound(entry)) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find(matches);

  return (
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command &&
        shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
        whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    (bindingWhen === "false"
      ? DEFAULT_RESOLVED_KEYBINDINGS.find(
          (entry) =>
            entry.command === binding.command &&
            shortcutToKeybindingInput(entry.shortcut) === bindingKey,
        )
      : undefined) ??
    findDefault(
      (entry) =>
        entry.command === binding.command && whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    findDefault((entry) => entry.command === binding.command)
  );
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

function conflictsWithWhen(leftWhen: string, rightWhen: string): boolean {
  if (leftWhen === "false" || rightWhen === "false") return false;
  // An empty condition and "true" are both always active.
  const always = (when: string) => when.length === 0 || when === "true";
  return always(leftWhen) || always(rightWhen) || leftWhen === rightWhen;
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
  platform = navigator.platform,
  resolve: MessageResolver = m,
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const shortcut = parseKeybindingShortcut(input.key);
  if (!shortcut) return [];
  // Compare resolved chords so mod+k and ctrl+k collide where mod is Ctrl.
  const conflictKey = shortcutConflictKey(shortcut, platform);
  const conflicts: Array<string> = [];
  for (const candidate of rows) {
    if (
      candidate.id !== input.rowId &&
      shortcutConflictKey(candidate.binding.shortcut, platform) === conflictKey &&
      conflictsWithWhen(candidate.when, input.when)
    ) {
      conflicts.push(commandLabel(candidate.command, resolve));
    }
  }
  return [...new Set(conflicts)].toSorted();
}

const WHEN_WORDS: Record<string, string> = {
  terminalFocus: msg("in the terminal"),
  terminalOpen: msg("when the terminal is open"),
  previewFocus: msg("in the preview"),
  previewOpen: msg("when the preview is open"),
  composerFocus: msg("in the composer"),
  editableFocus: msg("while typing in a field"),
  turnRunning: msg("while the agent is working"),
  rightPanelOpen: msg("when the right panel is open"),
  usagePageOpen: msg("on the Usage page"),
  modelPickerOpen: msg("when the model picker is open"),
  draftThreadRoute: msg("in a new thread"),
  isMac: msg("on a Mac"),
  isWeb: msg("in the browser"),
  isDesktop: msg("in the desktop app"),
};

const WHEN_NEGATED_WORDS: Record<string, string> = {
  terminalFocus: msg("outside the terminal"),
  previewFocus: msg("outside the preview"),
  composerFocus: msg("outside the composer"),
  editableFocus: msg("when not typing in a field"),
  draftThreadRoute: msg("in a thread that has started"),
  modelPickerOpen: msg("when the model picker is closed"),
  isMac: msg("not on a Mac"),
  isWeb: msg("not in the browser"),
  isDesktop: msg("not in the desktop app"),
};

/**
 * A `when` clause in words, such as "outside the terminal". Names with no wording
 * keep their raw spelling; the raw clause stays in the editor and on hover.
 */
export function describeWhen(
  node: KeybindingWhenNode | undefined,
  resolve: MessageResolver = m,
): string {
  if (!node) return "";
  const describe = (current: KeybindingWhenNode, nested: boolean): string => {
    switch (current.type) {
      case "identifier": {
        const words = WHEN_WORDS[current.name];
        return words ? resolve(words) : current.name;
      }
      case "not": {
        if (current.node.type === "identifier") {
          const words = WHEN_NEGATED_WORDS[current.node.name];
          if (words) return resolve(words);
        }
        return `!${describe(current.node, true)}`;
      }
      case "and":
      case "or": {
        const joined = `${describe(current.left, true)} ${
          current.type === "and"
            ? resolve(msg("and", { $context: "joins two conditions of a keyboard shortcut" }))
            : resolve(msg("or", { $context: "joins two conditions of a keyboard shortcut" }))
        } ${describe(current.right, true)}`;
        return nested ? `(${joined})` : joined;
      }
    }
  };
  return describe(node, false);
}

type SimplifiedWhen = KeybindingWhenNode | boolean;

function simplifyWhen(
  node: KeybindingWhenNode,
  known: ReadonlyMap<string, boolean>,
): SimplifiedWhen {
  switch (node.type) {
    case "identifier":
      return known.get(node.name) ?? node;
    case "not": {
      const inner = simplifyWhen(node.node, known);
      return typeof inner === "boolean" ? !inner : { type: "not", node: inner };
    }
    case "and":
    case "or": {
      const left = simplifyWhen(node.left, known);
      const right = simplifyWhen(node.right, known);
      const absorbing = node.type === "or";
      if (left === absorbing || right === absorbing) return absorbing;
      if (typeof left === "boolean") return right;
      if (typeof right === "boolean") return left;
      return { type: node.type, left, right };
    }
  }
}

/**
 * The condition left once the named terms are decided; null when it can never hold, undefined
 * when it always does.
 */
export function whenWithKnownTerms(
  node: KeybindingWhenNode | undefined,
  known: ReadonlyMap<string, boolean>,
): KeybindingWhenNode | null | undefined {
  if (!node) return undefined;
  const simplified = simplifyWhen(node, known);
  if (simplified === false) return null;
  return simplified === true ? undefined : simplified;
}

/** The condition left once platform terms are decided; null when it can never hold here. */
export function whenForPlatform(
  node: KeybindingWhenNode | undefined,
  platform = navigator.platform,
): KeybindingWhenNode | null | undefined {
  return whenWithKnownTerms(node, new Map([["isMac", isMacPlatform(platform)]]));
}

/** One command's keys under one condition: the first row edits the rest as alternates. */
export interface KeybindingRowSet {
  readonly row: KeybindingRow;
  readonly alternates: ReadonlyArray<KeybindingRow>;
}

/**
 * Rows for one command with the same written condition become one row with several keys;
 * different conditions stay apart because the When control edits only the first binding.
 * Defaults for another platform never fire here and are left out; user rules stay visible.
 */
export function collapseAlternateRows(
  rows: ReadonlyArray<KeybindingRow>,
  platform = navigator.platform,
): ReadonlyArray<KeybindingRowSet> {
  const sets = new Map<string, { row: KeybindingRow; alternates: KeybindingRow[] }>();
  for (const row of rows) {
    if (row.source === "Default" && whenForPlatform(row.binding.whenAst, platform) === null) {
      continue;
    }
    const id = `${row.command}\u0000${row.when}`;
    const existing = sets.get(id);
    if (existing) existing.alternates.push(row);
    else sets.set(id, { row, alternates: [] });
  }
  return [...sets.values()];
}

export interface KeybindingGroup {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<KeybindingRow>;
}

const KEYBINDING_GROUPS = [
  {
    id: "navigation",
    title: msg("Navigation"),
    prefixes: [
      "navigation",
      "sidebar",
      "rightPanel",
      "commandPalette",
      "filePicker",
      "projectSearch",
      "editor",
    ],
  },
  {
    id: "threads",
    title: msg("Threads"),
    prefixes: ["thread", "chat", "pullRequest"],
    headingArea: "thread",
  },
  {
    id: "approval",
    title: msg("Approval"),
    prefixes: ["approval"],
    headingArea: "approval",
  },
  {
    id: "composer",
    title: msg("Composer"),
    prefixes: ["composer", "modelPicker"],
    headingArea: "composer",
  },
  {
    id: "terminal",
    title: msg("Terminal"),
    prefixes: ["terminal"],
    headingArea: "terminal",
  },
  {
    id: "preview",
    title: msg("Preview & diff"),
    prefixes: ["preview", "diff"],
    headingArea: "preview",
  },
  {
    id: "appearance",
    title: msg("Appearance"),
    prefixes: ["theme", "appearance", "themeEditor"],
  },
  { id: "scripts", title: msg("Project scripts"), prefixes: ["script"] },
] as const;
const OTHER_KEYBINDING_GROUP = {
  id: "other",
  title: msg("Other", { $context: "keybinding group" }),
} as const;

export function keybindingHeadingArea(command: KeybindingCommand): string | undefined {
  return (keybindingGroupFor(command) as { readonly headingArea?: string }).headingArea;
}

function keybindingGroupFor(command: KeybindingCommand): { id: string; title: string } {
  const prefix = String(command).split(".")[0] ?? "";
  return (
    KEYBINDING_GROUPS.find((group) => (group.prefixes as ReadonlyArray<string>).includes(prefix)) ??
    OTHER_KEYBINDING_GROUP
  );
}

export function groupKeybindingRows(
  rows: ReadonlyArray<KeybindingRow>,
): ReadonlyArray<KeybindingGroup> {
  const rowsByGroup = new Map<string, Array<KeybindingRow>>();
  for (const row of rows) {
    const group = keybindingGroupFor(row.command);
    const bucket = rowsByGroup.get(group.id);
    if (bucket) bucket.push(row);
    else rowsByGroup.set(group.id, [row]);
  }
  return [...KEYBINDING_GROUPS, OTHER_KEYBINDING_GROUP].flatMap((group) => {
    const groupRows = rowsByGroup.get(group.id);
    return groupRows ? [{ id: group.id, title: group.title, rows: groupRows }] : [];
  });
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  platform = navigator.platform,
  sendShortcut: ClientSettings["sendShortcut"] = "enter",
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingRow> {
  // Multiline sending can use either shortcut; settings have no active composer prompt.
  const modifierModes =
    sendShortcut === "mod-enter-multiline" ? [false, true] : [sendShortcut === "mod-enter"];
  const previewLabels = keybindings.map(() => new Set<string>());
  for (const composerRequiresModifier of modifierModes) {
    const laterBindings = new Set<string>();
    for (let index = keybindings.length - 1; index >= 0; index--) {
      const binding = keybindings[index]!;
      const when = whenAstToExpression(binding.whenAst);
      if (when === "false") continue;
      const shortcut = shortcutForContext(binding, { composerRequiresModifier });
      const key = shortcutConflictKey(shortcut, platform);
      const conditionKey = `${key}:${when === "true" ? "" : when}`;
      // Distinct conditions may still apply in other focus contexts.
      if (!laterBindings.has(`${key}:`) && !laterBindings.has(conditionKey)) {
        previewLabels[index]!.add(formatShortcutLabel(shortcut, platform));
      }
      laterBindings.add(conditionKey);
    }
  }
  const rowsById = new Map<string, KeybindingRow>();
  for (const [index, binding] of keybindings.entries()) {
    const defaultBinding = defaultBindingForBinding(binding, keybindings);
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);
    const id = keybindingRowId(binding.command, key, when);
    rowsById.set(id, {
      id,
      command: binding.command,
      key,
      when,
      source: sourceForBinding(binding),
      isUnassigned:
        when === "false" &&
        defaultBinding !== undefined &&
        key === shortcutToKeybindingInput(defaultBinding.shortcut),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding,
      conflicts: [],
      previewLabels: [...previewLabels[index]!],
    });
  }
  const rows = [...rowsById.values()];

  const rowsWithConflicts = rows.map((row) => {
    const conflicts = keybindingConflictLabels(
      rows,
      {
        rowId: row.id,
        key: row.key,
        when: row.when,
      },
      platform,
      resolve,
    );
    return conflicts.length > 0
      ? Object.assign({}, row, { conflicts: [...new Set(conflicts)].toSorted() })
      : row;
  });

  rowsWithConflicts.sort((left, right) => {
    const commandCompare = compareCommands(left.command, right.command, commandSortKey);
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });

  return rowsWithConflicts;
}

export function filterKeybindingRows(
  rows: ReadonlyArray<KeybindingRow>,
  query: string,
  resolve: MessageResolver = m,
  platform = navigator.platform,
): ReadonlyArray<KeybindingRow> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return rows;
  return rows.filter((row) => {
    return (
      row.command.toLowerCase().includes(normalizedQuery) ||
      commandLabel(row.command, resolve).toLowerCase().includes(normalizedQuery) ||
      row.key.toLowerCase().includes(normalizedQuery) ||
      // The row shows the platform label ("Ctrl+K"), not the stored "mod+k".
      formatShortcutLabel(row.binding.shortcut, platform).toLowerCase().includes(normalizedQuery) ||
      row.when.toLowerCase().includes(normalizedQuery) ||
      row.source.toLowerCase().includes(normalizedQuery)
    );
  });
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function isKnownWhenVariable(identifier: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(identifier);
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !isKnownWhenVariable(identifier)).toSorted();
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>(STATIC_KEYBINDING_COMMANDS);
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) =>
    compareCommands(left, right, (command) => commandLabel(command, resolve)),
  );
}

const COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "workspace.focusNext": msg("Focus next workspace area"),
  "workspace.focusPrevious": msg("Focus previous workspace area"),
  "composer.sendAlternate": msg("Composer: opposite queue or steer action"),
  "composer.sendBackground": msg("Composer: start in background"),
  "composer.sendAndNewThread": msg("Composer: send and start new thread"),
  "composer.dictation": msg("Composer: start or finish dictation"),
  "thread.steerQueuedMessage": msg("Queue: send first queued message"),
  "thread.editQueuedMessage": msg("Queue: edit last queued message"),
  "thread.copyReference": msg("Pull request: copy link or thread"),
  "sidebar.toggle": msg("Sidebar: toggle"),
  "navigation.back": msg("Navigation: back"),
  "navigation.forward": msg("Navigation: forward"),
  "terminal.toggle": msg("Terminal: toggle"),
  "terminal.split": msg("Terminal: split"),
  "terminal.splitVertical": msg("Terminal: split vertical"),
  "terminal.new": msg("Terminal: new"),
  "terminal.close": msg("Terminal: close"),
  "terminal.previous": msg("Terminal: previous"),
  "terminal.next": msg("Terminal: next"),
  "rightPanel.toggle": msg("Right panel: toggle"),
  "rightPanel.new": msg("Right panel: new"),
  "threadPanel.toggle": msg("Thread panel: toggle"),
  "rightPanel.toggleMaximized": msg("Right panel: toggle maximized"),
  "rightPanel.close": msg("Right panel: close"),
  "pullRequest.copyNumber": msg("Pull request: copy number"),
  "diff.toggle": msg("Diff: toggle"),
  "preview.toggle": msg("Preview: toggle"),
  "preview.refresh": msg("Preview: refresh"),
  "preview.zoomIn": msg("Preview: zoom in"),
  "preview.zoomOut": msg("Preview: zoom out"),
  "preview.resetZoom": msg("Preview: reset zoom"),
  "commandPalette.toggle": msg("Command palette: toggle"),
  "filePicker.toggle": msg("File picker: toggle"),
  "projectSearch.toggle": msg("Project search: toggle"),
  "usage.open": msg("Usage: toggle"),
  "theme.select": msg("Theme: select"),
  "appearance.cycle": msg("Appearance: cycle"),
  "themeEditor.toggle": msg("Theme editor: toggle"),
  "workspaceMode.toggle": msg("Workspace: switch between Code and Chat"),
  "voiceChat.toggle": msg("Voice chat: start or end"),
  "composer.stash": msg("Composer: stash"),
  "composer.host": msg("Composer: host"),
  "composer.cycleHost": msg("Composer: cycle host"),
  "composer.effort": msg("Composer: effort"),
  "composer.increaseEffort": msg("Composer: increase effort"),
  "composer.decreaseEffort": msg("Composer: decrease effort"),
  "composer.mode": msg("Composer: mode"),
  "composer.workspace": msg("Composer: workspace"),
  "composer.previousWorktree": msg("Composer: previous worktree"),
  "composer.branch": msg("Composer: branch"),
  "chat.new": msg("Chat: new"),
  "chat.newLocal": msg("Chat: new local"),
  "chat.newWithoutProject": msg("Chat: new without project"),
  "chat.find": msg("Chat: find"),
  "editor.openFavorite": msg("Editor: open favorite"),
  "modelPicker.toggle": msg("Model picker: toggle"),
  "modelPicker.previousProvider": msg("Model picker: previous provider"),
  "modelPicker.nextProvider": msg("Model picker: next provider"),
  "thread.stop": msg("Thread: stop"),
  "thread.previous": msg("Thread: previous"),
  "thread.next": msg("Thread: next"),
  "thread.settle": msg("Thread: settle"),
  "thread.pin": msg("Thread: pin"),
  "thread.regenerateTitle": msg("Thread: regenerate title"),
  "thread.undo": msg("Thread: undo"),
};

// Whole labels: search titles keep the encoded message, which cannot nest another one.
const USAGE_COMMAND_LABELS: Record<
  (typeof METRIC_OPTIONS)[number]["command"] | (typeof WINDOW_OPTIONS)[number]["command"],
  string
> = {
  "usage.cost": msg("Usage: cost"),
  "usage.tokens": msg("Usage: tokens"),
  "usage.limits": msg("Usage: limits"),
  "usage.period.day": msg("Usage: period: past 24h"),
  "usage.period.week": msg("Usage: period: 7 days"),
  "usage.period.month": msg("Usage: period: 30 days"),
  "usage.period.quarter": msg("Usage: period: 90 days"),
};

const LATE_COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "view.reopenClosed": msg("Reopen closed tab"),
  "preview.focusUrl": msg("Preview: focus URL"),
  "preview.find": msg("Preview: find on page"),
  "shortcuts.show": msg("Keyboard shortcuts: show"),
  "approval.approve": msg("Approval: approve"),
  "approval.decline": msg("Approval: decline"),
};

/** The area a command belongs to, the first part of its id ("thread" for "thread.next"). */
function commandArea(command: KeybindingCommand): string {
  return String(command).split(".")[0] ?? "";
}

/**
 * What a command is called under a heading that already names its area: "Next" under "Thread".
 * Each is its own message, so every language words it itself instead of cutting a prefix off the
 * full label.
 */
const COMMAND_ACTION_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "thread.stop": msg("Stop"),
  "thread.previous": msg("Previous"),
  "thread.next": msg("Next"),
  "thread.settle": msg("Settle"),
  "thread.pin": msg("Pin"),
  "thread.regenerateTitle": msg("Regenerate title"),
  "thread.undo": msg("Undo"),
  "approval.approve": msg("Approve"),
  "approval.decline": msg("Decline"),
  "composer.sendAlternate": msg("Send the other way (interrupt or wait)"),
  "composer.sendBackground": msg("Start in background"),
  "composer.sendAndNewThread": msg("Send and start new thread"),
  "composer.dictation": msg("Start or finish dictation"),
  "composer.stash": msg("Stash"),
  "composer.host": msg("Host"),
  "composer.cycleHost": msg("Cycle host"),
  "composer.effort": msg("Effort"),
  "composer.increaseEffort": msg("Increase effort"),
  "composer.decreaseEffort": msg("Decrease effort"),
  "composer.mode": msg("Mode"),
  "composer.workspace": msg("Workspace"),
  "composer.previousWorktree": msg("Previous worktree"),
  "composer.branch": msg("Branch"),
  "terminal.toggle": msg("Toggle"),
  "terminal.split": msg("Split"),
  "terminal.splitVertical": msg("Split vertical"),
  "terminal.new": msg("New"),
  "terminal.close": msg("Close"),
  "preview.toggle": msg("Toggle"),
  "preview.refresh": msg("Refresh"),
  "preview.zoomIn": msg("Zoom in"),
  "preview.zoomOut": msg("Zoom out"),
  "preview.resetZoom": msg("Reset zoom"),
  "preview.focusUrl": msg("Focus URL"),
  "preview.find": msg("Find on page"),
  "chat.new": msg("New"),
  "chat.newLocal": msg("New local"),
  "chat.newWithoutProject": msg("New without project"),
  "chat.find": msg("Find"),
  "appearance.cycle": msg("Cycle"),
};

/**
 * A command's label for a list under a heading for `headingArea` (a command area such as
 * "thread"): the short action when the heading already names the command's area, and the full
 * label otherwise, so "Pull request: copy number" keeps the context its heading does not give.
 * Settings and the shortcut sheet both use this one function.
 */
export function commandActionLabel(
  command: KeybindingCommand,
  resolve: MessageResolver = m,
  headingArea?: string,
): string {
  const area = commandArea(command);
  if (headingArea === undefined || headingArea !== area) return commandLabel(command, resolve);
  const action = COMMAND_ACTION_LABELS[command];
  if (action) return resolve(action);
  const raw = String(command);
  if (raw.startsWith("thread.jump.")) {
    return resolve(msg("Jump to {n}", { n: raw.slice("thread.jump.".length) }));
  }
  return commandLabel(command, resolve);
}

export function commandLabel(command: KeybindingCommand, resolve: MessageResolver = m): string {
  const label = COMMAND_LABELS[command];
  if (label) return resolve(label);
  const usageLabel = USAGE_COMMAND_LABELS[command as keyof typeof USAGE_COMMAND_LABELS];
  if (usageLabel) return resolve(usageLabel);
  const lateLabel = LATE_COMMAND_LABELS[command];
  if (lateLabel) return resolve(lateLabel);
  const raw = String(command);
  if (raw.startsWith("thread.jump.")) {
    return resolve(msg("Thread: jump to {n}", { n: raw.slice("thread.jump.".length) }));
  }
  if (raw.startsWith("modelPicker.jump.")) {
    return resolve(
      msg("Model picker: jump to model {n}", { n: raw.slice("modelPicker.jump.".length) }),
    );
  }
  if (raw.startsWith("script.") && raw.endsWith(".run")) {
    return resolve(
      msg("Run script: {name}", {
        name: sentenceCaseCommandSegment(raw.slice("script.".length, -".run".length), true),
      }),
    );
  }
  return raw
    .split(".")
    .map((segment, index) => sentenceCaseCommandSegment(segment, index === 0))
    .join(": ");
}

function sentenceCaseCommandSegment(segment: string, capitalize: boolean): string {
  const words = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
  const text = words.join(" ");
  return capitalize ? text.slice(0, 1).toUpperCase() + text.slice(1) : text;
}

function recordedLayoutShortcutKey(
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "altKey">,
  platform: string,
): string {
  const physicalKey = shortcutKeyFromEvent(event, platform);
  const layoutKey = event.key.toLowerCase();
  if (event.altKey || layoutKey.length !== 1) return physicalKey;
  // A non-Latin letter (Cyrillic, Greek, ...) stops matching once the user switches to a Latin layout.
  if (/^\p{L}$/u.test(layoutKey) && !/\p{Script=Latin}/u.test(layoutKey)) {
    return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : physicalKey;
  }
  // Normalize only US shifted glyphs at their US position. Other layouts can
  // produce the same glyph without Shift or at a different position.
  const unshiftedKey = event.shiftKey ? US_SHIFTED_TO_UNSHIFTED_KEYS.get(layoutKey) : undefined;
  return unshiftedKey === physicalKey ? physicalKey : layoutKey;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
  options?: {
    readonly layoutCharacter?: boolean;
  },
): string | null {
  const keyToken = normalizeShortcutKeyToken(
    options?.layoutCharacter
      ? recordedLayoutShortcutKey(event, platform)
      : shortcutKeyFromEvent(event, platform),
  );
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);
  return parts.join("+");
}

const SPOKEN_MODIFIERS: Readonly<Record<string, string>> = {
  "\u2303": "Control",
  "\u2325": "Option",
  "\u21e7": "Shift",
  "\u2318": "Command",
};
const SPOKEN_KEYS: Readonly<Record<string, string>> = {
  "\u2191": "Up arrow",
  "\u2193": "Down arrow",
  "\u2190": "Left arrow",
  "\u2192": "Right arrow",
  "\u21b5": "Enter",
};

/** A shortcut as a screen reader should say it: the glyphs of the visual label become names. */
export function spokenShortcutLabel(shortcut: KeybindingShortcut, platform?: string): string {
  return formatShortcutLabel(shortcut, platform)
    .replace(/[\u2303\u2325\u21e7\u2318]/g, (glyph) => `${SPOKEN_MODIFIERS[glyph]}+`)
    .replace(/[\u2191\u2193\u2190\u2192\u21b5]/g, (glyph) => SPOKEN_KEYS[glyph]!);
}
