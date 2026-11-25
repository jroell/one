import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";

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
}

export interface ShortcutSheetSection {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<ShortcutSheetRow>;
}

// Most keys apply outside the terminal; repeating that on every row would bury the exceptions.
const DEFAULT_WHEN = "!terminalFocus";

interface DraftRow {
  readonly row: Omit<ShortcutSheetRow, "keys">;
  readonly keys: Array<ReadonlyArray<string>>;
  readonly claimed: Set<string>;
}

function isUnassigned(binding: ResolvedKeybindingsConfig[number]): boolean {
  return binding.whenAst?.type === "identifier" && binding.whenAst.name === "false";
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
  for (const binding of keybindings) {
    const when = whenForPlatform(binding.whenAst, platform);
    if (when === null || isUnassigned(binding)) continue;
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
    const conflictKey = shortcutConflictKey(binding.shortcut, platform);
    if (draft.claimed.has(conflictKey)) continue;
    draft.claimed.add(conflictKey);
    draft.keys.push(shortcutKeycaps(binding.shortcut, platform));
  }

  const needle = query.trim().toLowerCase();
  const matches = (row: ShortcutSheetRow) =>
    needle === "" ||
    [row.label, row.command, row.qualifier ?? "", ...row.keys.map((caps) => caps.join(" "))].some(
      (text) => text.toLowerCase().includes(needle),
    );
  const rowsBySection = new Map<string, ShortcutSheetRow[]>();
  for (const { row, keys } of drafts.values()) {
    const sheetRow = { ...row, keys };
    if (!matches(sheetRow)) continue;
    const sectionId = commandSectionFor(row.command);
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
