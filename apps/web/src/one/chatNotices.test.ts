import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "~/session-logic";
import { noticeKind, planChatNotices } from "./chatNotices";

const entry = (id: string, itemType?: string) =>
  ({ id, createdAt: "2026-01-01T00:00:00Z", label: id, tone: "tool", itemType }) as WorkLogEntry;
const workRow = (id: string, ...entries: WorkLogEntry[]) =>
  ({
    kind: "work",
    id,
    createdAt: "",
    groupedEntries: entries,
    isExpandedToolGroup: false,
  }) as MessagesTimelineRow;
const userRow = (id: string) =>
  ({ kind: "message", id, message: { role: "user", id } }) as unknown as MessagesTimelineRow;

describe("planChatNotices", () => {
  it("gives the last notice-bearing row of a turn every notice of that turn and earlier rows none", () => {
    const plan = planChatNotices([
      userRow("q1"),
      workRow("w1", entry("n1", "system_notice"), entry("tool", "command_execution")),
      workRow("w2", entry("n2", "system_notice")),
    ]);
    expect(plan.get("w1")?.notices).toEqual([]);
    expect(plan.get("w2")?.notices.map((notice) => notice.id)).toEqual(["n1", "n2"]);
  });

  it("keeps each turn's notices in that turn, and gives rows with no notice no plan", () => {
    const plan = planChatNotices([
      userRow("q1"),
      workRow("w1", entry("n1", "system_notice")),
      userRow("q2"),
      workRow("w2", entry("tool", "command_execution")),
      workRow("w3", entry("n2", "system_notice")),
    ]);
    expect(plan.get("w1")?.notices.map((notice) => notice.id)).toEqual(["n1"]);
    expect(plan.has("w2")).toBe(false);
    expect(plan.get("w3")?.notices.map((notice) => notice.id)).toEqual(["n2"]);
  });
});

describe("noticeKind", () => {
  const signInNotice = (server: string, providerThreadId: string | null = "pt-1") =>
    ({
      id: `sign-in-${server}`,
      createdAt: "2026-01-01T00:00:00Z",
      label: `MCP server ${server} needs a sign-in`,
      tone: "info",
      itemType: "system_notice",
      structuredPayload: {
        type: "system_notice",
        message: "needs a sign-in",
        providerThreadId,
        mcpSignIn: { server },
      },
    }) as unknown as WorkLogEntry;
  const toolCall = (toolName: string) =>
    ({
      id: `tool-${toolName}`,
      createdAt: "2026-01-01T00:00:00Z",
      label: "Search",
      tone: "tool",
      itemType: "dynamic_tool",
      structuredPayload: { type: "dynamic_tool", toolName },
    }) as unknown as WorkLogEntry;

  it("matches a sign-in notice for plugin:exa:exa with the tool call mcp__plugin_exa_exa__search of the same turn", () => {
    const plan = planChatNotices([
      userRow("q1"),
      workRow("w1", toolCall("mcp__plugin_exa_exa__search")),
      workRow("w2", signInNotice("plugin:exa:exa"), signInNotice("plugin:productivity:notion")),
    ]);
    const { notices, usedServers } = plan.get("w2")!;
    expect(notices.map((entry) => noticeKind(entry, usedServers))).toEqual(["needed", "sign-in"]);
  });

  it("does not count a tool call from an earlier turn as a request for the tool", () => {
    const plan = planChatNotices([
      userRow("q1"),
      workRow("w1", toolCall("mcp__plugin_exa_exa__search")),
      userRow("q2"),
      workRow("w2", signInNotice("plugin:exa:exa")),
    ]);
    const { notices, usedServers } = plan.get("w2")!;
    expect(noticeKind(notices[0]!, usedServers)).toBe("sign-in");
  });

  it("leaves a sign-in the notice cannot start, and a plain warning, to the status dot", () => {
    const warning = {
      id: "warn",
      createdAt: "2026-01-01T00:00:00Z",
      label: "Heads up",
      tone: "info",
      itemType: "system_notice",
      structuredPayload: { type: "system_notice", message: "slow start", level: "warning" },
    } as unknown as WorkLogEntry;
    expect(noticeKind(signInNotice("linear", null), new Set())).toBe("quiet");
    expect(noticeKind(warning, new Set())).toBe("quiet");
  });
});
