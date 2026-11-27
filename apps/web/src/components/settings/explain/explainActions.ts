import { msg } from "gt-react";

import type { ExplainAction, ExplainTopicId } from "./explainTypes";

const USAGE: ExplainAction = { label: msg("Open Usage limits"), href: "/usage" };
const PROVIDERS: ExplainAction = { label: msg("Open Providers"), href: "/settings/providers" };
const SHARING: ExplainAction = { label: msg("Open Sharing & access"), href: "/settings/access" };
const ENVIRONMENTS: ExplainAction = {
  label: msg("Open Environments"),
  href: "/settings/connections",
};
const LABS: ExplainAction = { label: msg("Open Labs"), href: "/settings/labs" };

/**
 * Where each topic's answer can send the person: one to three places, each opening the exact page
 * the topic is about. The address names the page; an `action` in it opens a dialog once on arrival.
 */
export const EXPLAIN_ACTIONS: Readonly<Record<ExplainTopicId, ReadonlyArray<ExplainAction>>> = {
  "usage-providers": [USAGE, PROVIDERS],
  "usage-hub": [{ label: msg("Add a hub"), href: "/settings/providers?action=add-hub" }, USAGE],
  "usage-http-source": [
    { label: msg("Add an HTTP source"), href: "/settings/providers?action=add-http-source" },
    USAGE,
  ],
  "usage-sign-in": [PROVIDERS, USAGE],
  "usage-no-accounts": [USAGE, PROVIDERS],
  "text-generators": [PROVIDERS],
  providers: [PROVIDERS, USAGE],
  "provider-status": [PROVIDERS],
  "provider-runtime": [PROVIDERS],
  snapshots: [{ label: msg("Open Snapshots"), href: "/settings/snap-shot" }],
  "scheduled-tasks": [{ label: msg("Open Scheduled tasks"), href: "/settings/scheduled-tasks" }],
  archive: [{ label: msg("Open Archive"), href: "/settings/archived" }],
  devices: [{ label: msg("Open Devices"), href: "/settings/devices" }],
  "guest-links": [LABS],
  "linked-environments": [ENVIRONMENTS, LABS],
  workflows: [LABS],
  "preview-tunnel": [SHARING],
  environments: [ENVIRONMENTS],
  "t3-connect": [SHARING, ENVIRONMENTS],
  "authorized-clients": [SHARING],
  secrets: [{ label: msg("Open Secrets"), href: "/settings/secrets" }],
  "voice-transcription": [{ label: msg("Open Voice"), href: "/settings/voice" }],
  "source-control-providers": [
    { label: msg("Open Source control"), href: "/settings/source-control" },
  ],
  "background-activity": [{ label: msg("Open Maintenance"), href: "/settings/maintenance" }],
  "browser-profiles": [{ label: msg("Open Browser"), href: "/settings/browser" }],
  "project-file": [{ label: msg("Open Projects"), href: "/settings/projects" }],
  "chat-settings": [{ label: msg("Open Chat settings"), href: "/settings/chat" }],
  "threads-settings": [{ label: msg("Open Threads"), href: "/settings/threads" }],
  "codex-provider": [PROVIDERS],
  labs: [LABS],
  "source-control": [{ label: msg("Open Source control"), href: "/settings/source-control" }],
  worktrees: [{ label: msg("Open Worktrees"), href: "/settings/worktrees" }],
  maintenance: [{ label: msg("Open Maintenance"), href: "/settings/maintenance" }],
  "keyboard-shortcuts": [{ label: msg("Open Keyboard shortcuts"), href: "/settings/keybindings" }],
  "settings-scope": [{ label: msg("Open Projects"), href: "/settings/projects" }],
};
