import type {
  ClientSettings,
  KeybindingCommand,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { shortcutConflictKey, shortcutForContext, spokenKeycapName } from "../../keybindings";
import { COMMAND_SECTIONS, commandSectionFor } from "../../shortcuts/commandSections";
import { shortcutKeycaps } from "../../shortcuts/shortcutKeycaps";
import {
  commandActionLabel,
  commandLabel,
  commandSortKey,
  describeWhen,
  whenAstToExpression,
  whenForPlatform,
  whenWithKnownTerms,
} from "../settings/KeybindingsSettings.logic";

export interface ShortcutSheetRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly label: string;
  /** Where the keys apply, in words; null when they work everywhere outside the terminal. */
  readonly qualifier: string | null;
  /** Each alternate key, as the caps to draw. */
  readonly keys: ReadonlyArray<ReadonlyArray<string>>;
  /** "or" between alternates; "to" between the first and last key of a numbered family. */
  readonly keysJoiner: "or" | "to";
  /** Every key the row stands for, so filtering finds a key a collapsed family does not draw. */
  readonly matchKeys: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortcutSheetSection {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<ShortcutSheetRow>;
}

// Most keys apply outside the terminal; repeating that on every row would bury the exceptions.
const DEFAULT_WHEN = "!terminalFocus";

interface DraftRow {
  readonly row: Omit<ShortcutSheetRow, "keys" | "keysJoiner" | "matchKeys">;
  readonly keys: Array<ReadonlyArray<string>>;
  readonly claimed: Set<string>;
}

/** Commands that differ only by a number, listed as one row from the first to the last. */
const NUMBERED_FAMILIES = [
  {
    prefix: "thread.jump.",
    area: "thread",
    full: (first: string, last: string, resolve: MessageResolver) =>
      resolve(msg("Thread: jump to thread {first} to {last}", { first, last })),
    short: (first: string, last: string, resolve: MessageResolver) =>
      resolve(msg("Jump to thread {first} to {last}", { first, last })),
  },
  {
    prefix: "modelPicker.jump.",
    area: "modelPicker",
    full: (first: string, last: string, resolve: MessageResolver) =>
      resolve(msg("Model picker: jump to model {first} to {last}", { first, last })),
    short: (first: string, last: string, resolve: MessageResolver) =>
      resolve(msg("Jump to model {first} to {last}", { first, last })),
  },
] as const;

// More terms than this would make the check below slow; such a rule is never treated as shadowed.
const MAX_SHADOW_TERMS = 12;
// Work one comparison may cost, in condition evaluations; a costlier one is treated as not shadowed.
const MAX_COMPARISON_WORK = 4096;
// Work all comparisons for one config may cost together. Past it, remaining keys are shown.
const MAX_TOTAL_WORK = 60_000;

function collectWhenTerms(node: KeybindingWhenNode | undefined, into: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      if (node.name !== "true" && node.name !== "false") into.add(node.name);
      return;
    case "not":
      collectWhenTerms(node.node, into);
      return;
    case "and":
    case "or":
      collectWhenTerms(node.left, into);
      collectWhenTerms(node.right, into);
  }
}

/** Whether `node` holds when exactly the terms whose bit is set in `mask` are true. */
function holds(
  node: KeybindingWhenNode | undefined,
  mask: number,
  bitOf: ReadonlyMap<string, number>,
): boolean {
  if (!node) return true;
  switch (node.type) {
    case "identifier": {
      if (node.name === "true") return true;
      const bit = bitOf.get(node.name);
      return bit !== undefined && ((mask >> bit) & 1) === 1;
    }
    case "not":
      return !holds(node.node, mask, bitOf);
    case "and":
      return holds(node.left, mask, bitOf) && holds(node.right, mask, bitOf);
    case "or":
      return holds(node.left, mask, bitOf) || holds(node.right, mask, bitOf);
  }
}

interface ShadowBudget {
  remaining: number;
}

/**
 * Whether, in every context where `when` holds, one of the `later` conditions holds too. When the
 * answer would cost more than the budget allows, it is "no", so the key is shown.
 */
function alwaysCoveredBy(
  when: KeybindingWhenNode | undefined,
  later: ReadonlyArray<KeybindingWhenNode | undefined>,
  budget: ShadowBudget,
): boolean {
  if (later.some((condition) => condition === undefined)) return true;
  const terms = new Set<string>();
  collectWhenTerms(when, terms);
  for (const condition of later) collectWhenTerms(condition, terms);
  if (terms.size > MAX_SHADOW_TERMS) return false;
  const cost = 2 ** terms.size * (1 + later.length);
  if (cost > MAX_COMPARISON_WORK || cost > budget.remaining) return false;
  budget.remaining -= cost;
  const bitOf = new Map([...terms].map((name, index) => [name, index] as const));
  for (let mask = 0; mask < 2 ** terms.size; mask += 1) {
    if (holds(when, mask, bitOf) && !later.some((condition) => holds(condition, mask, bitOf))) {
      return false;
    }
  }
  return true;
}

function isUnassigned(binding: ResolvedKeybindingsConfig[number]): boolean {
  return binding.whenAst?.type === "identifier" && binding.whenAst.name === "false";
}

function toSheetRow(draft: DraftRow): ShortcutSheetRow {
  return { ...draft.row, keys: draft.keys, keysJoiner: "or", matchKeys: draft.keys };
}

/**
 * Whether the numbered commands are one unbroken run whose keys differ only by that number: the
 * same modifiers, then the digit that matches the command. A gap, a command left unassigned or a
 * key moved to anything else breaks it.
 */
function isUnbrokenRun(
  sorted: ReadonlyArray<{ readonly number: number; readonly draft: DraftRow }>,
): boolean {
  const first = sorted[0];
  if (!first || sorted.length < 2) return false;
  const modifiers = (caps: ReadonlyArray<string>) => caps.slice(0, -1).join("\u0000");
  const firstCaps = first.draft.keys[0];
  if (!firstCaps) return false;
  return sorted.every((member, index) => {
    const caps = member.draft.keys[0];
    return (
      member.draft.keys.length === 1 &&
      caps !== undefined &&
      member.number === first.number + index &&
      caps.at(-1) === String(member.number) &&
      modifiers(caps) === modifiers(firstCaps)
    );
  });
}

/**
 * One row for each numbered family and condition, from its first number to its last, when every
 * command in it has one key of the same pattern. Otherwise the commands keep their own rows.
 */
function collapseNumberedFamilies(
  drafts: ReadonlyArray<DraftRow>,
  resolve: MessageResolver,
): ReadonlyArray<ShortcutSheetRow> {
  const rows: ShortcutSheetRow[] = [];
  const families = new Map<string, Array<{ readonly number: number; readonly draft: DraftRow }>>();
  for (const draft of drafts) {
    const command = String(draft.row.command);
    const family = NUMBERED_FAMILIES.find((candidate) => command.startsWith(candidate.prefix));
    const number = family ? Number(command.slice(family.prefix.length)) : Number.NaN;
    if (!family || !Number.isInteger(number)) {
      rows.push(toSheetRow(draft));
      continue;
    }
    const key = `${family.prefix}\u0000${draft.row.id.split("\u0000")[1]}`;
    families.set(key, [...(families.get(key) ?? []), { number, draft }]);
  }
  for (const [key, members] of families) {
    const family = NUMBERED_FAMILIES.find((candidate) => key.startsWith(candidate.prefix));
    const sorted = members.toSorted((left, right) => left.number - right.number);
    const first = sorted[0];
    const last = sorted.at(-1);
    if (!family || !first || !last || !isUnbrokenRun(sorted)) {
      rows.push(...sorted.map((member) => toSheetRow(member.draft)));
      continue;
    }
    rows.push({
      ...first.draft.row,
      id: key,
      // Under a heading that names the family's area, the area word is left off.
      label: (commandSectionFor(first.draft.row.command) === family.area
        ? family.short
        : family.full)(String(first.number), String(last.number), resolve),
      keys: [first.draft.keys[0]!, last.draft.keys[0]!],
      keysJoiner: "to",
      matchKeys: sorted.flatMap((member) => member.draft.keys),
    });
  }
  return rows;
}

/** The send shortcut changes Mod+Enter into Mod+Shift+Enter for two commands, so each mode is its own chord set. */
function modifierModesFor(sendShortcut: ClientSettings["sendShortcut"]): ReadonlyArray<boolean> {
  return sendShortcut === "mod-enter-multiline" ? [false, true] : [sendShortcut === "mod-enter"];
}

interface RowOptions {
  readonly platform: string;
  readonly sendShortcut: ClientSettings["sendShortcut"];
  readonly resolve: MessageResolver;
}

/**
 * The bound commands with the keys in force now. The dispatcher lets the newest matching rule
 * win, so a key that a later rule for another command always takes in the same contexts never
 * runs this command. That is judged on the chords the dispatcher matches, after the send shortcut
 * has moved a chord, and within a work budget.
 */
function buildShortcutRows(
  keybindings: ResolvedKeybindingsConfig,
  { platform, sendShortcut, resolve }: RowOptions,
): ReadonlyArray<ShortcutSheetRow> {
  const drafts = new Map<string, DraftRow>();
  const platformWhens = keybindings.map((binding) => whenForPlatform(binding.whenAst, platform));
  const budget: ShadowBudget = { remaining: MAX_TOTAL_WORK };
  const modes = modifierModesFor(sendShortcut).map((composerRequiresModifier) => {
    const shortcuts = keybindings.map((binding) =>
      shortcutForContext(binding, { composerRequiresModifier }),
    );
    // The mode decides a condition on the send shortcut: a chord that needs the other mode does
    // not exist here (null). Only the chat sets the term; elsewhere it reads as false, so a
    // binding outside the composer is judged that way before it is left out.
    const whens = platformWhens.map((when, index) => {
      if (when === null) return null;
      const inMode = whenWithKnownTerms(
        when,
        new Map([["composerRequiresModifier", composerRequiresModifier]]),
      );
      if (inMode !== null || keybindings[index]!.command.startsWith("composer.")) return inMode;
      return whenWithKnownTerms(when, new Map([["composerRequiresModifier", false]]));
    });
    const conflictKeys = shortcuts.map((shortcut) => shortcutConflictKey(shortcut, platform));
    const sameKey = new Map<string, number[]>();
    keybindings.forEach((_, index) => {
      if (whens[index] === null) return;
      const key = conflictKeys[index]!;
      const group = sameKey.get(key);
      if (group) group.push(index);
      else sameKey.set(key, [index]);
    });
    return { shortcuts, whens, conflictKeys, sameKey };
  });
  keybindings.forEach((binding, index) => {
    const when = platformWhens[index];
    if (when === null || isUnassigned(binding)) return;
    const expression = whenAstToExpression(when);
    const id = `${binding.command}\u0000${expression}`;
    for (const { shortcuts, whens, conflictKeys, sameKey } of modes) {
      const modeWhen = whens[index];
      if (modeWhen === null) continue;
      const conflictKey = conflictKeys[index]!;
      const shadowers: Array<KeybindingWhenNode | undefined> = [];
      for (const later of sameKey.get(conflictKey) ?? []) {
        const laterWhen = whens[later];
        if (
          later > index &&
          laterWhen !== null &&
          keybindings[later]!.command !== binding.command
        ) {
          shadowers.push(laterWhen);
        }
      }
      if (shadowers.length > 0 && alwaysCoveredBy(modeWhen, shadowers, budget)) continue;
      let draft = drafts.get(id);
      if (!draft) {
        draft = {
          row: {
            id,
            command: binding.command,
            // Under a heading that already names the command's area, "Thread: next" is "Next".
            label: commandActionLabel(binding.command, resolve, commandSectionFor(binding.command)),
            qualifier:
              expression === "" || expression === DEFAULT_WHEN ? null : describeWhen(when, resolve),
          },
          keys: [],
          claimed: new Set(),
        };
        drafts.set(id, draft);
      }
      if (draft.claimed.has(conflictKey)) continue;
      draft.claimed.add(conflictKey);
      draft.keys.push(shortcutKeycaps(shortcuts[index]!, platform));
    }
  });
  return collapseNumberedFamilies([...drafts.values()], resolve);
}

// Building the rows is the costly part and depends only on the config, so a filter keystroke
// reuses them. A new config object, platform, send shortcut or language builds them again.
const rowCache = new WeakMap<
  ResolvedKeybindingsConfig,
  RowOptions & { readonly rows: ReadonlyArray<ShortcutSheetRow> }
>();

function rowsFor(
  keybindings: ResolvedKeybindingsConfig,
  options: RowOptions,
): ReadonlyArray<ShortcutSheetRow> {
  const cached = rowCache.get(keybindings);
  if (
    cached &&
    cached.platform === options.platform &&
    cached.sendShortcut === options.sendShortcut &&
    cached.resolve === options.resolve
  ) {
    return cached.rows;
  }
  const rows = buildShortcutRows(keybindings, options);
  rowCache.set(keybindings, { ...options, rows });
  return rows;
}

/**
 * Every bound command under the palette's headings, with the keys in force now:
 * custom keys included, unassigned and other-platform keys left out.
 */
export function buildShortcutSections(
  keybindings: ResolvedKeybindingsConfig,
  options: {
    readonly query?: string;
    readonly platform?: string;
    readonly resolve?: MessageResolver;
    readonly sendShortcut?: ClientSettings["sendShortcut"];
  } = {},
): ReadonlyArray<ShortcutSheetSection> {
  const {
    query = "",
    platform = navigator.platform,
    resolve = m,
    sendShortcut = "enter",
  } = options;
  const sheetRows = rowsFor(keybindings, { platform, sendShortcut, resolve });
  const needle = query.trim().toLowerCase();
  const matches = (row: ShortcutSheetRow) =>
    needle === "" ||
    [
      row.label,
      commandLabel(row.command, resolve),
      row.command,
      row.qualifier ?? "",
      ...row.matchKeys.flatMap((caps) => [
        caps.join(" "),
        // The names, so "enter" or "up" finds a key the sheet draws as a glyph.
        caps.map(spokenKeycapName).join(" "),
      ]),
    ].some((text) => text.toLowerCase().includes(needle));
  const rowsBySection = new Map<string, ShortcutSheetRow[]>();
  for (const sheetRow of sheetRows) {
    if (!matches(sheetRow)) continue;
    const sectionId = commandSectionFor(sheetRow.command);
    rowsBySection.set(sectionId, [...(rowsBySection.get(sectionId) ?? []), sheetRow]);
  }
  return COMMAND_SECTIONS.flatMap((section) => {
    const rows = rowsBySection.get(section.id);
    return rows
      ? [
          {
            id: section.id,
            title: resolve(section.title),
            // The order Settings lists commands in: by area, with a pair (next, previous) together.
            rows: rows.toSorted((left, right) =>
              commandSortKey(left.command).localeCompare(commandSortKey(right.command), undefined, {
                numeric: true,
              }),
            ),
          },
        ]
      : [];
  });
}
