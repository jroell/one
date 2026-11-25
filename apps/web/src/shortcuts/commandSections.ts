import type { KeybindingCommand } from "@t3tools/contracts";
import { msg } from "gt-react";

/** Headings shared by the command palette and the keyboard shortcuts sheet, in display order. */
export const COMMAND_SECTIONS = [
  { id: "thread", title: msg("Thread", { $context: "command group heading" }) },
  { id: "chat", title: msg("Chat", { $context: "command group heading" }) },
  { id: "composer", title: msg("Composer", { $context: "command group heading" }) },
  { id: "view", title: msg("View", { $context: "command group heading" }) },
  { id: "git", title: msg("Git", { $context: "command group heading" }) },
  { id: "project", title: msg("Project", { $context: "command group heading" }) },
  { id: "navigate", title: msg("Navigate", { $context: "command group heading" }) },
  { id: "appearance", title: msg("Appearance", { $context: "command group heading" }) },
  { id: "help", title: msg("Help", { $context: "command group heading" }) },
] as const;

export type CommandSectionId = (typeof COMMAND_SECTIONS)[number]["id"];

const SECTION_BY_PREFIX: Readonly<Record<string, CommandSectionId>> = {
  thread: "thread",
  chat: "chat",
  composer: "composer",
  modelPicker: "composer",
  voiceChat: "composer",
  terminal: "view",
  rightPanel: "view",
  threadPanel: "view",
  diff: "view",
  preview: "view",
  sidebar: "view",
  view: "view",
  workspaceMode: "view",
  pullRequest: "git",
  script: "project",
  navigation: "navigate",
  workspace: "navigate",
  commandPalette: "navigate",
  filePicker: "navigate",
  projectSearch: "navigate",
  usage: "navigate",
  editor: "navigate",
  theme: "appearance",
  appearance: "appearance",
  themeEditor: "appearance",
  shortcuts: "help",
};

const SECTION_BY_COMMAND: Partial<Record<KeybindingCommand, CommandSectionId>> = {
  "thread.steerQueuedMessage": "composer",
  "thread.editQueuedMessage": "composer",
  "thread.copyReference": "git",
  "composer.branch": "git",
  "composer.workspace": "git",
  "composer.previousWorktree": "git",
};

/** The heading a command sits under, so a shortcut and its palette row never disagree. */
export function commandSectionFor(command: KeybindingCommand): CommandSectionId {
  return (
    SECTION_BY_COMMAND[command] ??
    SECTION_BY_PREFIX[String(command).split(".")[0] ?? ""] ??
    "navigate"
  );
}
