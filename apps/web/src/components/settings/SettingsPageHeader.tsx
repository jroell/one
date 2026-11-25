import { useLocation } from "@tanstack/react-router";
import { msg, useMessages } from "gt-react";

import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

interface SettingsPageIntro {
  readonly title: string;
  readonly purpose: string;
}

const section = (
  path: keyof typeof SETTINGS_SECTION_LABELS,
  purpose: string,
): SettingsPageIntro => ({
  title: SETTINGS_SECTION_LABELS[path],
  purpose,
});

/** One title and one line of purpose per page, keyed by path. */
export const SETTINGS_PAGE_INTROS: Readonly<Record<string, SettingsPageIntro>> = {
  "/settings/general": section(
    "/settings/general",
    msg("Notifications, the sidebar, confirmations and language on this device."),
  ),
  "/settings/appearance": section(
    "/settings/appearance",
    msg("Color scheme, themes, interface options and typography."),
  ),
  "/settings/chat": section(
    "/settings/chat",
    msg("How the composer, follow-ups and tool calls behave."),
  ),
  "/settings/diffs": section(
    "/settings/diffs",
    msg("How diffs are drawn and how pull requests are reviewed."),
  ),
  "/settings/keybindings": section(
    "/settings/keybindings",
    msg("Shortcuts for every command. Change, add or remove them here."),
  ),
  "/settings/voice": section(
    "/settings/voice",
    msg("Microphone, transcription and your dictionary."),
  ),
  "/settings/snap-shot": section(
    "/settings/snap-shot",
    msg("Capture part of your screen and send it to a thread."),
  ),
  "/settings/providers": section(
    "/settings/providers",
    msg("Agent providers, their accounts and models, and where usage is counted."),
  ),
  "/settings/threads": section(
    "/settings/threads",
    msg("Defaults for new projects and threads, snoozing and settling."),
  ),
  "/settings/browser": section(
    "/settings/browser",
    msg("The shared browser agents use, its profiles and recordings."),
  ),
  "/settings/devices": section(
    "/settings/devices",
    msg("Simulators and emulators for the Device panel."),
  ),
  "/settings/scheduled-tasks": section(
    "/settings/scheduled-tasks",
    msg("Prompts that start threads on a schedule."),
  ),
  "/settings/projects": section(
    "/settings/projects",
    msg("Names, icons, checkouts and actions for each project."),
  ),
  "/settings/source-control": section(
    "/settings/source-control",
    msg("Repositories, accounts, issue trackers and how commits are written."),
  ),
  "/settings/worktrees": section(
    "/settings/worktrees",
    msg("Where worktrees are created and how they are named."),
  ),
  "/settings/connections": section(
    "/settings/connections",
    msg("The machines One can run threads on."),
  ),
  "/settings/access": section(
    "/settings/access",
    msg("Who and what can connect to an environment."),
  ),
  "/settings/secrets": section("/settings/secrets", msg("Keys and tokens your threads can use.")),
  "/settings/maintenance": section(
    "/settings/maintenance",
    msg("Updates, background activity and cleanup."),
  ),
  "/settings/labs": section("/settings/labs", msg("Early features. They can change or go away.")),
  "/settings/about": section("/settings/about", msg("Version, mobile apps and legal notices.")),
  "/settings/archived": section("/settings/archived", msg("Threads you archived.")),
  "/settings/diagnostics": {
    title: msg("Diagnostics"),
    purpose: msg("Processes, resource use and logs on this environment."),
  },
  "/settings/open-source-licenses": {
    title: msg("Open source licenses"),
    purpose: msg("Notices for the software One is built with."),
  },
};

/** True for a settings page that exists. An unknown address under /settings opens General. */
export function isKnownSettingsPathname(pathname: string): boolean {
  return SETTINGS_PAGE_INTROS[pathname.replace(/\/+$/, "") || "/"] !== undefined;
}

/** The current page's intro, or null for an address that has none. */
export function useSettingsPageIntro() {
  const m = useMessages();
  const pathname = useLocation({ select: (location) => location.pathname });
  const intro = SETTINGS_PAGE_INTROS[pathname.replace(/\/+$/, "") || "/"];
  return intro ? { title: m(intro.title), purpose: m(intro.purpose) } : null;
}

export function SettingsPageHeader() {
  const intro = useSettingsPageIntro();
  if (!intro) return null;
  return (
    <header data-settings-page-header="" className="flex flex-col gap-1 px-3 sm:px-4">
      <h1 data-settings-page-title="">{intro.title}</h1>
      <p data-settings-page-purpose="">{intro.purpose}</p>
    </header>
  );
}
