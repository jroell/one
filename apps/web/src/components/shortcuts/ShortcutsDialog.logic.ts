import type {
  KeybindingCommand,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { shortcutConflictKey } from "../../keybindings";
import { COMMAND_SECTIONS, commandSectionFor } from "../../shortcuts/commandSections";
import { shortcutKeycaps } from "../../shortcuts/shortcutKeycaps";
import {
  commandLabel,
  describeWhen,
  whenAstToExpression,
  whenForPlatform,
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
}

export interface ShortcutSheetSection {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<ShortcutSheetRow>;
}

// Most keys apply outside the terminal; repeating that on every row would bury the exceptions.
const DEFAULT_WHEN = "!terminalFocus";

interface DraftRow {
  readonly row: Omit<ShortcutSheetRow, "keys" | "keysJoiner">;
  readonly keys: Array<ReadonlyArray<string>>;
  readonly claimed: Set<string>;
}

/** Commands that differ only by a number, listed as one row from the first to the last. */
const NUMBERED_FAMILIES = [
  {
    prefix: "thread.jump.",
    label: (first: string, last: string, resolve: MessageResolver) =>
      resolve(msg("Thread: jump to thread {first} to {last}", { first, last })),
  },
  {
    prefix: "modelPicker.jump.",
    label: (first: string, last: string, resolve: MessageResolver) =>
      resolve(msg("Model picker: jump to model {first} to {last}", { first, last })),
  },
] as const;

// More terms than this would make the check below slow; such a rule is never treated as shadowed.
const MAX_SHADOW_TERMS = 12;

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

function holds(node: KeybindingWhenNode | undefined, trueTerms: ReadonlySet<string>): boolean {
  if (!node) return true;
  switch (node.type) {
    case "identifier":
      return node.name === "true" || (node.name !== "false" && trueTerms.has(node.name));
    case "not":
      return !holds(node.node, trueTerms);
    case "and":
      return holds(node.left, trueTerms) && holds(node.right, trueTerms);
    case "or":
      return holds(node.left, trueTerms) || holds(node.right, trueTerms);
  }
}

/** Whether, in every context where `when` holds, one of the `later` conditions holds too. */
function alwaysCoveredBy(
  when: KeybindingWhenNode | undefined,
  later: ReadonlyArray<KeybindingWhenNode | undefined>,
): boolean {
  if (later.some((condition) => condition === undefined)) return true;
  const terms = new Set<string>();
  collectWhenTerms(when, terms);
  for (const condition of later) collectWhenTerms(condition, terms);
  if (terms.size > MAX_SHADOW_TERMS) return false;
  const names = [...terms];
  for (let mask = 0; mask < 2 ** names.length; mask += 1) {
    const trueTerms = new Set(names.filter((_, index) => (mask >> index) & 1));
    if (holds(when, trueTerms) && !later.some((condition) => holds(condition, trueTerms))) {
      return false;
    }
  }
  return true;
}

function isUnassigned(binding: ResolvedKeybindingsConfig[number]): boolean {
  return binding.whenAst?.type === "identifier" && binding.whenAst.name === "false";
}

function toSheetRow(draft: DraftRow): ShortcutSheetRow {
  return { ...draft.row, keys: draft.keys, keysJoiner: "or" };
}

/**
 * One row for each numbered family and condition, from its first number to its last, when every
 * command in it has one key. Otherwise the commands keep their own rows.
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
    if (
      !family ||
      !first ||
      !last ||
      sorted.length < 2 ||
      sorted.some((member) => member.draft.keys.length !== 1)
    ) {
      rows.push(...sorted.map((member) => toSheetRow(member.draft)));
      continue;
    }
    rows.push({
      ...first.draft.row,
      id: key,
      label: family.label(String(first.number), String(last.number), resolve),
      keys: [first.draft.keys[0]!, last.draft.keys[0]!],
      keysJoiner: "to",
    });
  }
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
  } = {},
): ReadonlyArray<ShortcutSheetSection> {
  const { query = "", platform = navigator.platform, resolve = m } = options;
  const drafts = new Map<string, DraftRow>();
  const conflictKeys = keybindings.map((binding) =>
    shortcutConflictKey(binding.shortcut, platform),
  );
  const platformWhens = keybindings.map((binding) => whenForPlatform(binding.whenAst, platform));
  keybindings.forEach((binding, index) => {
    const when = platformWhens[index];
    if (when === null || isUnassigned(binding)) return;
    // The dispatcher lets the newest matching rule win, so a key that a later rule for another
    // command always takes in the same contexts never runs this command.
    const shadowers: Array<KeybindingWhenNode | undefined> = [];
    for (let later = index + 1; later < keybindings.length; later += 1) {
      const laterWhen = platformWhens[later];
      if (
        laterWhen !== null &&
        keybindings[later]!.command !== binding.command &&
        conflictKeys[later] === conflictKeys[index]
      ) {
        shadowers.push(laterWhen);
      }
    }
    if (shadowers.length > 0 && alwaysCoveredBy(when, shadowers)) return;
    const expression = whenAstToExpression(when);
    const id = `${binding.command}\u0000${expression}`;
    let draft = drafts.get(id);
    if (!draft) {
      draft = {
        row: {
          id,
          command: binding.command,
          label: commandLabel(binding.command, resolve),
          qualifier:
            expression === "" || expression === DEFAULT_WHEN ? null : describeWhen(when, resolve),
        },
        keys: [],
        claimed: new Set(),
      };
      drafts.set(id, draft);
    }
    if (draft.claimed.has(conflictKeys[index]!)) return;
    draft.claimed.add(conflictKeys[index]!);
    draft.keys.push(shortcutKeycaps(binding.shortcut, platform));
  });

  const sheetRows = collapseNumberedFamilies([...drafts.values()], resolve);
  const needle = query.trim().toLowerCase();
  const matches = (row: ShortcutSheetRow) =>
    needle === "" ||
    [row.label, row.command, row.qualifier ?? "", ...row.keys.map((caps) => caps.join(" "))].some(
      (text) => text.toLowerCase().includes(needle),
    );
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
            rows: rows.toSorted((left, right) =>
              left.label.localeCompare(right.label, undefined, { numeric: true }),
            ),
          },
        ]
      : [];
  });
}
