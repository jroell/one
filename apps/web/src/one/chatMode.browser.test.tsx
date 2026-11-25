import { MessageId, RunId, RuntimeRequestId, TurnItemId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { deriveTimelineEntriesFromVisibleTurnItems, type PendingApproval } from "~/session-logic";
import { makeStreamingTimelineFixture } from "~/test-fixtures";
import { act, render } from "../../test/render";
import { setWorkspaceMode } from "./workspaceMode";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const CREATED_AT = "2026-03-17T19:12:28.000Z";
const ENVIRONMENT_ID = "environment-local" as TimelineProps["activeThreadEnvironmentId"];

function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  return {
    isWorking: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: `environment-local:thread-${Math.random().toString(36).slice(2)}`,
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "dark",
    timestampFormat: "locale",
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    onAnchorSizeChanged: () => {},
    contentInsetEndAdjustment: 0,
    emptyPlaceholderInset: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
  };
}

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
  runId: RunId | null = null,
): Entry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
    },
  };
}

/** Motion is allowed whatever the machine running the test prefers. */
function motion(reduced: boolean): Disposable {
  const original = window.matchMedia.bind(window);
  const spy = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? (reduced ? "all" : "not all") : query),
    );
  return { [Symbol.dispose]: () => spy.mockRestore() };
}

function inMode(mode: "chat" | "code"): Disposable {
  setWorkspaceMode(mode);
  return { [Symbol.dispose]: () => setWorkspaceMode("code") };
}

async function renderTimeline(props: TimelineProps) {
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  return render(<MessagesTimeline {...props} />, { container });
}

/**
 * A running or finished turn with one file read. `approval` adds the request that
 * waits on the person, matched to a pending approval on the timeline.
 */
function turnFixture({ approval, finished }: { approval: boolean; finished: boolean }) {
  const fixture = makeStreamingTimelineFixture();
  const [, , , user, work, assistant] = fixture.visibleTurnItems;
  if (user?.item.type !== "user_message" || work?.item.type !== "dynamic_tool") {
    throw new Error("Expected the live fixture items");
  }
  if (assistant?.item.type !== "assistant_message") throw new Error("Expected live assistant");
  const requestId = RuntimeRequestId.make("command-approval");
  const pending: PendingApproval = {
    requestId,
    requestKind: "command",
    createdAt: fixture.time(6),
    detail: "git status",
    reason: "Needs permission to run the command",
    fullAccessOverride: "ask_rule",
    responseCapability: "live",
  };
  const approvalRow = {
    ...work,
    position: work.position + 1,
    sourceItemId: TurnItemId.make("approval-0"),
    item: {
      ...work.item,
      id: TurnItemId.make("approval-0"),
      type: "approval_request" as const,
      status: "waiting" as const,
      requestId,
      requestKind: "command" as const,
      prompt: pending.detail,
    },
  };
  const answer = {
    ...assistant,
    item: { ...assistant.item, text: "The file is short.", streaming: false, status: "completed" },
  } as typeof assistant;
  const visibleTurnItems = [
    user,
    work,
    ...(approval ? [approvalRow] : []),
    ...(finished ? [answer] : []),
  ];
  return {
    runId: fixture.runId,
    pending,
    entries: deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems,
      optimisticMessages: [],
    }),
    latestRun: {
      runId: fixture.runId,
      status: finished ? ("completed" as const) : ("running" as const),
      startedAt: fixture.time(5),
      completedAt: finished ? fixture.time(8) : null,
    },
  };
}

it("Chat mode folds a finished turn's tool rows behind one Worked for line that opens to the rows", async () => {
  using _mode = inMode("chat");
  const turn = turnFixture({ approval: false, finished: true });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
  });

  const disclosure = screen.getByRole("button", { name: /^Worked for/ });
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(screen.container.querySelectorAll('[data-timeline-row-kind="turn-fold"]')).toHaveLength(1);
  expect(screen.container.textContent).not.toContain("index.ts");

  await disclosure.click();
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText(/index\.ts/).first()).toBeVisible();
});

it("Chat mode hides a running turn's tool rows and keeps its approval request actionable", async () => {
  using _mode = inMode("chat");
  const turn = turnFixture({ approval: true, finished: false });
  const onRespondToApproval = vi.fn(async () => {});
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
    isWorking: true,
    runningRunId: turn.runId,
    pendingApprovals: [turn.pending],
    canOperateThread: true,
    onRespondToApproval,
  });

  await expect.element(screen.getByRole("group", { name: "Command approval" })).toBeVisible();
  expect(screen.container.textContent).not.toContain("index.ts");
  expect(screen.container.querySelector('[data-timeline-row-kind="working"]')).not.toBeNull();

  await screen.getByRole("button", { name: "Approve", exact: true }).click();
  expect(onRespondToApproval).toHaveBeenLastCalledWith(turn.pending.requestId, "accept");
});

it("Code mode keeps a running turn's tool rows next to its approval request", async () => {
  using _mode = inMode("code");
  const turn = turnFixture({ approval: true, finished: false });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
    isWorking: true,
    runningRunId: turn.runId,
    pendingApprovals: [turn.pending],
    canOperateThread: true,
    onRespondToApproval: async () => {},
  });

  await expect.element(screen.getByRole("group", { name: "Command approval" })).toBeVisible();
  await expect.element(screen.getByText(/index\.ts/).first()).toBeVisible();
});

function turns(count: number): Entry[] {
  return Array.from({ length: count }, (_, index) => [
    message(`ask-${index}`, "user", `Question number ${index + 1}\nwith a second line`),
    message(`answer-${index}`, "assistant", "Reply.\n\n".repeat(60)),
  ]).flat();
}

async function wideViewport(width: number): Promise<AsyncDisposable> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 900);
  return { [Symbol.asyncDispose]: () => page.viewport(before.width, before.height) };
}

it("Chat mode lists one outline entry per user turn and jumps to the turn that is activated", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const props = baseProps();
  await using screen = await renderTimeline({ ...props, timelineEntries: turns(5) });

  const outline = screen.getByRole("navigation", { name: "In this chat" });
  await expect.element(outline).toBeVisible();
  const entries = outline.getByRole("button");
  expect(entries.elements()).toHaveLength(5);
  const reading = () => outline.element().querySelector("[aria-current]")?.textContent;
  await vi.waitFor(() => expect(reading()).toBe("Question number 5"));

  const viewport = props.listRef.current!.getScrollableNode()!;
  const topOf = (id: string) =>
    screen.container.querySelector(`[data-message-id="${id}"]`)?.getBoundingClientRect().top;
  await entries.nth(3).click();
  await vi.waitFor(() => {
    expect(viewport.scrollTop).toBeGreaterThan(0);
    const top = topOf("ask-3");
    expect(top).toBeDefined();
    expect(top! - viewport.getBoundingClientRect().top).toBeLessThan(120);
  });
  await vi.waitFor(() => expect(reading()).toBe("Question number 4"));

  entries.first().element().focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(entries.nth(1)).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => {
    expect(topOf("ask-1")! - viewport.getBoundingClientRect().top).toBeLessThan(120);
  });
});

it("Chat mode shows no outline for two turns or below 1280px, and Code mode never shows one", async () => {
  using _motion = motion(true);
  {
    using _mode = inMode("chat");
    await using _viewport = await wideViewport(1440);
    await using two = await renderTimeline({ ...baseProps(), timelineEntries: turns(2) });
    await expect
      .element(two.getByRole("navigation", { name: "In this chat" }))
      .not.toBeInTheDocument();
  }
  {
    using _mode = inMode("chat");
    await using _viewport = await wideViewport(1100);
    await using narrow = await renderTimeline({ ...baseProps(), timelineEntries: turns(5) });
    const nav = narrow.container.querySelector<HTMLElement>(".one-chat-outline");
    expect(nav).not.toBeNull();
    expect(getComputedStyle(nav!).display).toBe("none");
  }
  {
    using _mode = inMode("code");
    await using _viewport = await wideViewport(1440);
    await using code = await renderTimeline({ ...baseProps(), timelineEntries: turns(5) });
    expect(code.container.querySelector(".one-chat-outline")).toBeNull();
  }
});

function arrivals(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[data-chat-arrival]")].map(
    (row) => row.dataset.messageId,
  );
}

it("Chat mode marks a newly arrived answer once and leaves answers already on screen alone", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  const props = baseProps();
  const opening = turns(2);
  await using screen = await renderTimeline({ ...props, timelineEntries: opening });
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[data-message-id="answer-1"]')).not.toBeNull(),
  );
  expect(arrivals(screen.container)).toEqual([]);

  await screen.rerender(
    <MessagesTimeline
      {...props}
      timelineEntries={[
        ...opening,
        message("ask-2", "user", "One more question"),
        message("answer-2", "assistant", "A fresh answer"),
      ]}
    />,
  );
  await vi.waitFor(() => expect(arrivals(screen.container)).toEqual(["answer-2"]));

  const row = screen.container.querySelector<HTMLElement>('[data-message-id="answer-2"]')!;
  await act(async () => {
    row.dispatchEvent(
      new AnimationEvent("animationend", { animationName: "one-chat-arrive", bubbles: true }),
    );
  });
  await vi.waitFor(() => expect(arrivals(screen.container)).toEqual([]));
});

it("Chat mode marks no arrival under reduced motion, and Code mode marks none either", async () => {
  const props = baseProps();
  const opening = turns(1);
  const arrived = [...opening, message("answer-late", "assistant", "A late answer")];
  for (const [mode, reduced] of [
    ["chat", true],
    ["code", false],
  ] as const) {
    using _mode = inMode(mode);
    using _motion = motion(reduced);
    await using screen = await renderTimeline({
      ...props,
      routeThreadKey: `environment-local:thread-${mode}`,
      timelineEntries: opening,
    });
    await screen.rerender(
      <MessagesTimeline
        {...props}
        routeThreadKey={`environment-local:thread-${mode}`}
        timelineEntries={arrived}
      />,
    );
    await expect.element(screen.getByText("A late answer")).toBeVisible();
    expect(arrivals(screen.container)).toEqual([]);
  }
});
