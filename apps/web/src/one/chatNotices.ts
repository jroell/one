import { createContext } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "~/session-logic";

/** A notice from the run: a warning, a server that did not start, a fact. Not a failed turn. */
function isNoticeEntry(entry: WorkLogEntry): boolean {
  return entry.itemType === "system_notice";
}

export interface ChatNoticeRowPlan {
  /** The notices this row's turn ends with, shown as one quiet line. Empty on an earlier row. */
  readonly notices: ReadonlyArray<WorkLogEntry>;
  /** The MCP servers (as `mcpServerKey`) this turn called a tool of. Carried with `notices`. */
  readonly usedServers: ReadonlySet<string>;
  /**
   * The app asked a question in this thread with notes the person cannot see (a guided
   * conversation, a quiz), so tools it never called are none of the person's business here.
   */
  readonly fromApp: boolean;
  /** The ids of this row's notices that leave the row because the line shows them. */
  readonly folded: ReadonlySet<string>;
}

const NO_SERVERS: ReadonlySet<string> = new Set();

const NO_CHAT_NOTICES: ReadonlyMap<string, ChatNoticeRowPlan> = new Map();

/** The notice plan for the rows on screen; empty outside Chat mode. */
export const ChatNoticePlanContext = createContext(NO_CHAT_NOTICES);

/** One spelling of a server's name, so a notice's `plugin:exa:exa` meets a tool's `plugin_exa_exa`. */
function mcpServerKey(server: string): string {
  return server.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

/** The MCP server a tool call belongs to, as `mcpServerKey`, or null for any other entry. */
export function usedServerOf(entry: WorkLogEntry): string | null {
  const key = entry.toolSource?.key;
  if (key?.startsWith("mcp:")) return mcpServerKey(key.slice(4));
  const payload = entry.structuredPayload;
  const name = payload?.type === "dynamic_tool" ? payload.toolName : null;
  const qualified = name === null ? null : /^mcp__(.+?)__/i.exec(name);
  return qualified?.[1] ? mcpServerKey(qualified[1]) : null;
}

/**
 * Chat mode folds a turn's notices into one line at the end of the turn: the last notice-bearing
 * row of a turn carries all of them, earlier rows none. Rows without notices have no plan.
 */
export function planChatNotices(
  rows: ReadonlyArray<MessagesTimelineRow>,
  scope: "chat" | "code" = "chat",
): ReadonlyMap<string, ChatNoticeRowPlan> {
  // Most threads have no notice at all, and this runs on every render.
  if (!rows.some((row) => row.kind === "work" && row.groupedEntries.some(isNoticeEntry))) {
    return NO_CHAT_NOTICES;
  }
  const plans = new Map<string, ChatNoticeRowPlan>();
  let turnRowIds: string[] = [];
  let turnRowNotices = new Map<string, WorkLogEntry[]>();
  let turnNotices: WorkLogEntry[] = [];
  let turnServers = new Set<string>();
  const fromApp = rows.some(
    (row) =>
      row.kind === "message" &&
      row.message.role === "user" &&
      row.message.context?.agentContext !== undefined,
  );
  const closeTurn = () => {
    const folds = (entry: WorkLogEntry) =>
      scope === "chat" || noticeKind(entry, turnServers) === "sign-in";
    const folded = turnNotices.filter(folds);
    const last = turnRowIds.findLast((id) => (turnRowNotices.get(id) ?? []).some(folds));
    for (const id of turnRowIds) {
      const own = new Set((turnRowNotices.get(id) ?? []).filter(folds).map((entry) => entry.id));
      if (own.size === 0) continue;
      plans.set(
        id,
        id === last
          ? { notices: folded, usedServers: turnServers, fromApp, folded: own }
          : { notices: [], usedServers: NO_SERVERS, fromApp, folded: own },
      );
    }
    turnRowIds = [];
    turnRowNotices = new Map();
    turnNotices = [];
    turnServers = new Set();
  };
  for (const row of rows) {
    if (row.kind === "message" && row.message.role === "user") {
      closeTurn();
      continue;
    }
    // A finished turn folds its tool calls away; the fold still says which servers they used.
    if (row.kind === "turn-fold")
      for (const server of row.summary?.servers ?? []) turnServers.add(server);
    for (const entry of row.kind === "work"
      ? row.groupedEntries
      : row.kind === "work-live"
        ? [row.entry]
        : []) {
      const server = usedServerOf(entry);
      if (server !== null) turnServers.add(server);
    }
    if (row.kind !== "work") continue;
    const notices = row.groupedEntries.filter(isNoticeEntry);
    if (notices.length === 0) continue;
    turnRowIds.push(row.id);
    turnRowNotices.set(row.id, notices);
    turnNotices.push(...notices);
  }
  closeTurn();
  return plans.size === 0 ? NO_CHAT_NOTICES : plans;
}

export function noticeLevel(entry: WorkLogEntry): "info" | "warning" | "error" {
  return entry.structuredPayload?.type === "system_notice"
    ? (entry.structuredPayload.level ?? "warning")
    : "warning";
}

/** A server that needs a sign-in, when the notice offers the sign-in itself. */
export function signInOf(
  entry: WorkLogEntry,
): { readonly server: string; readonly key: string } | null {
  const payload = entry.structuredPayload;
  if (payload?.type !== "system_notice" || payload.mcpSignIn === undefined) return null;
  if (payload.providerThreadId === null) return null;
  return { server: payload.mcpSignIn.server, key: mcpServerKey(payload.mcpSignIn.server) };
}

/**
 * How a notice shows in Chat. `needed` is in view, in words, with its action: an error, or a
 * sign-in for a tool this turn called. `sign-in` is a tool the turn never called, which only
 * gets one quiet line with the others. `quiet` waits behind the header's status dot.
 */
export type ChatNoticeKind = "needed" | "sign-in" | "quiet";

export function noticeKind(entry: WorkLogEntry, usedServers: ReadonlySet<string>): ChatNoticeKind {
  if (noticeLevel(entry) === "error") return "needed";
  const signIn = signInOf(entry);
  if (signIn === null) return "quiet";
  return usedServers.has(signIn.key) ? "needed" : "sign-in";
}

/** The notices a turn raised that need nothing from the person, newest last. */
export function quietNotices(plans: Iterable<ChatNoticeRowPlan>): WorkLogEntry[] {
  const quiet: WorkLogEntry[] = [];
  for (const plan of plans) {
    for (const entry of plan.notices) {
      if (noticeKind(entry, plan.usedServers) === "quiet") quiet.push(entry);
    }
  }
  return quiet;
}

/** The tool's own words for a notice, when they add to its title. */
export function noticeDetail(entry: WorkLogEntry): string | null {
  const message =
    entry.structuredPayload?.type === "system_notice" ? entry.structuredPayload.message : null;
  return message !== null && message !== entry.label ? message : null;
}
