import {
  MessageId,
  ProviderDriverKind,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  TurnItemId,
} from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { deriveTimelineEntriesFromVisibleTurnItems, type PendingApproval } from "~/session-logic";
import { makeStreamingTimelineFixture } from "~/test-fixtures";
import { act, fakeTimers, render } from "../../test/render";
import { ComposerHandleContext } from "~/composerHandleContext";
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
function turnFixture({
  approval,
  finished,
  work: workKind = "tool",
}: {
  approval: boolean;
  finished: boolean;
  /** "reasoning" swaps the file read for the agent's reasoning, so no tool ran. */
  work?: "tool" | "reasoning";
}) {
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
  const reasoning = {
    ...work,
    item: {
      ...work.item,
      type: "reasoning" as const,
      text: "I should check the file before I answer.",
      streaming: false,
    },
  };
  const visibleTurnItems = [
    user,
    workKind === "reasoning" ? reasoning : work,
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

it("Chat mode hides a finished turn's tool rows behind one quiet Used 1 tool line that opens to the rows", async () => {
  using _mode = inMode("chat");
  const turn = turnFixture({ approval: false, finished: true });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
  });

  const disclosure = screen.getByRole("button", { name: /^Used 1 tool/ });
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(screen.container.querySelectorAll('[data-timeline-row-kind="turn-fold"]')).toHaveLength(1);
  expect(screen.container.textContent).not.toContain("index.ts");

  await disclosure.click();
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText(/index\.ts/).first()).toBeVisible();
});

it("Chat mode names a finished turn that only reasoned Thought for its time, and Code mode keeps Worked for", async () => {
  const turn = turnFixture({ approval: false, finished: true, work: "reasoning" });
  const props = { ...baseProps(), timelineEntries: turn.entries, latestRun: turn.latestRun };
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline(props);
    await expect.element(screen.getByRole("button", { name: /^Thought for/ })).toBeVisible();
    expect(screen.container.textContent).not.toContain("Worked for");
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline(props);
    await expect.element(screen.getByRole("button", { name: /^Worked for/ })).toBeVisible();
  }
});

it("Chat mode sets opened reasoning small and quiet, never the size of the answer", async () => {
  using _mode = inMode("chat");
  const turn = turnFixture({ approval: false, finished: true, work: "reasoning" });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
  });
  await screen.getByRole("button", { name: /^Thought for/ }).click();
  await screen.getByText("I should check the file before I answer.").first().click();
  const reasoning = await vi.waitFor(() => {
    const element = screen.container.querySelector<HTMLElement>(
      "[data-one-work-details] .chat-markdown",
    );
    expect(element).not.toBeNull();
    return element!;
  });
  const answer = screen.container.querySelector<HTMLElement>(
    '[data-message-role="assistant"] .chat-markdown',
  )!;
  expect(Number.parseFloat(getComputedStyle(reasoning).fontSize)).toBe(14);
  expect(Number.parseFloat(getComputedStyle(answer).fontSize)).toBe(18);
  expect(getComputedStyle(reasoning).color).not.toBe(getComputedStyle(answer).color);
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

it("Chat mode shows no outline for two turns, a narrow timeline or a short one, and keeps the minimap there", async () => {
  using _motion = motion(true);
  using _mode = inMode("chat");
  await using _viewport = await wideViewport(1440);
  const outlineIn = async (turnCount: number, size: { width: number; height: number }) => {
    const container = document.createElement("div");
    container.style.cssText = `height: ${size.height}px; width: ${size.width}px; display: flex; flex-direction: column;`;
    const screen = await render(
      <MessagesTimeline {...baseProps()} timelineEntries={turns(turnCount)} />,
      { container },
    );
    return screen;
  };
  const wide = { width: 1184, height: 700 };
  for (const [name, turnCount, size] of [
    ["two turns", 2, wide],
    ["a narrow timeline", 5, { width: 900, height: 700 }],
    ["a short timeline", 5, { width: 1184, height: 360 }],
  ] as const) {
    await using screen = await outlineIn(turnCount, size);
    await vi.waitFor(() =>
      expect(
        screen.container.querySelector('[data-testid="timeline-minimap"]'),
        name,
      ).not.toBeNull(),
    );
    expect(screen.container.querySelector(".one-chat-outline"), name).toBeNull();
    expect(
      getComputedStyle(screen.container.querySelector('[data-testid="timeline-minimap"]')!).display,
      name,
    ).not.toBe("none");
  }
  {
    await using full = await outlineIn(5, wide);
    await expect.element(full.getByRole("navigation", { name: "In this chat" })).toBeVisible();
    expect(full.container.querySelector('[data-testid="timeline-minimap"]')).not.toBeNull();
    expect(
      getComputedStyle(full.container.querySelector('[data-testid="timeline-minimap"]')!).display,
    ).toBe("none");
  }
});

/** The row positions the outline reads from the list while the view scrolls, as row indexes. */
async function outlinePositionReadsWhileScrolling(listRef: TimelineProps["listRef"]) {
  const list = listRef.current!;
  const reads: number[] = [];
  const getState = list.getState.bind(list);
  list.getState = () => {
    const state = getState();
    return {
      ...state,
      positionAtIndex: (index) => {
        // Other scroll work reads positions too; only the outline's own reads count here.
        if (new Error().stack?.includes("resolveOutlineCurrentIndex")) reads.push(index);
        return state.positionAtIndex(index);
      },
    };
  };
  using _timers = fakeTimers();
  const scroller = list.getScrollableNode() as HTMLElement;
  scroller.scrollTop = 1500;
  scroller.dispatchEvent(new Event("scroll"));
  await act(() => vi.advanceTimersByTime(50));
  list.getState = getState;
  return reads;
}

it.each([
  ["shown", { width: 1184, height: 700 }],
  ["hidden", { width: 900, height: 700 }],
] as const)(
  "Chat mode finds the turn being read from a few row positions while the outline is %s in a 60 turn thread",
  async (name, size) => {
    using _motion = motion(true);
    using _mode = inMode("chat");
    await using _viewport = await wideViewport(1440);
    const props = baseProps();
    const container = document.createElement("div");
    container.style.cssText = `height: ${size.height}px; width: ${size.width}px; display: flex; flex-direction: column;`;
    await using screen = await render(<MessagesTimeline {...props} timelineEntries={turns(60)} />, {
      container,
    });
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-testid="timeline-minimap"]')).not.toBeNull(),
    );
    expect(screen.container.querySelector(".one-chat-outline") !== null).toBe(name === "shown");
    // The list has measured once the minimap marks the turns in view.
    await vi.waitFor(() => expect(screen.container.querySelector("[data-in-view]")).not.toBeNull());
    const reads = await outlinePositionReadsWhileScrolling(props.listRef);
    if (name === "hidden") {
      expect(reads).toEqual([]);
    } else {
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.length).toBeLessThan(60);
    }
  },
);

/**
 * The conversation pane as ChatView lays it out: the timeline fills it, and the composer's dock
 * floats over its bottom edge, as tall as `dockHeight`, with the composer inside it.
 */
function dockedScene(
  props: TimelineProps,
  { dockHeight, scrollAway }: { dockHeight: number; scrollAway: boolean },
) {
  return (
    <div style={{ position: "relative", height: 700, width: 1184 }}>
      <MessagesTimeline {...props} contentInsetEndAdjustment={dockHeight} />
      <div
        data-chat-composer-overlay="true"
        data-composer-dock=""
        data-scroll-to-end-shown={scrollAway ? "" : undefined}
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          zIndex: 20,
          height: dockHeight,
          paddingTop: 8,
          pointerEvents: "none",
        }}
      >
        <div
          data-testid="composer"
          style={{ margin: "0 auto", width: 688, height: dockHeight - 28 }}
        />
      </div>
    </div>
  );
}

const LONG_ANSWER = Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${index + 1} of a long answer, set at reading size.`,
).join("\n\n");

it("Chat mode rests the last line of a long answer at least 24px above the composer's top edge", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const props = {
    ...baseProps(),
    timelineEntries: [
      message("ask", "user", "Tell me more"),
      message("answer", "assistant", LONG_ANSWER),
    ],
  };
  await using screen = await render(dockedScene(props, { dockHeight: 140, scrollAway: false }));
  const scroller = await vi.waitFor(() => {
    const element = screen.container.querySelector<HTMLElement>(".messages-timeline-scroll");
    expect(element).not.toBeNull();
    return element!;
  });
  await vi.waitFor(() => {
    scroller.scrollTop = scroller.scrollHeight;
    expect(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop).toBeLessThanOrEqual(
      1,
    );
  });
  const composerTop = screen.getByTestId("composer").element().getBoundingClientRect().top;
  const paragraphs = screen.container.querySelectorAll<HTMLElement>(".chat-markdown > p");
  const lastLine = paragraphs[paragraphs.length - 1]!.getBoundingClientRect();
  expect(lastLine.bottom).toBeLessThanOrEqual(composerTop - 24);
});

it("Chat mode's dock is opaque to the window's edge, and gains a fade and a clear pill band only while scrolled away", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const props = {
    ...baseProps(),
    timelineEntries: [
      message("ask", "user", "Tell me more"),
      message("answer", "assistant", LONG_ANSWER),
    ],
  };
  const dockOf = (screen: { container: HTMLElement }) =>
    screen.container.querySelector<HTMLElement>("[data-chat-composer-overlay]")!;
  {
    await using atEnd = await render(dockedScene(props, { dockHeight: 140, scrollAway: false }));
    const dock = dockOf(atEnd);
    // The dock's own layer is solid, so no line of the answer shows beside or under the composer.
    const solid = getComputedStyle(dock, "::before");
    expect(solid.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(solid.position).toBe("absolute");
    expect(getComputedStyle(dock, "::after").opacity).toBe("0");
  }
  {
    await using away = await render(dockedScene(props, { dockHeight: 140, scrollAway: true }));
    const fade = getComputedStyle(dockOf(away), "::after");
    expect(fade.opacity).toBe("1");
    // 96px of fade above 40px of clear band for the pill.
    expect(Number.parseFloat(fade.height)).toBe(136);
  }
});

it("Chat mode sets an answer in the serif by default and in the sans when the reading face is sans", async () => {
  using _mode = inMode("chat");
  const turn = turnFixture({ approval: false, finished: true });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
  });
  const answer = () =>
    screen.container.querySelector<HTMLElement>('[data-message-role="assistant"] .chat-markdown')!;
  await vi.waitFor(() => expect(answer()).not.toBeNull());
  const serif = getComputedStyle(document.documentElement).getPropertyValue("--one-serif").trim();
  expect(getComputedStyle(answer()).fontFamily).toBe(serif);

  document.documentElement.dataset.chatReadingFace = "sans";
  try {
    expect(getComputedStyle(answer()).fontFamily).toBe(getComputedStyle(document.body).fontFamily);
    expect(getComputedStyle(answer()).fontFamily).not.toBe(serif);
  } finally {
    delete document.documentElement.dataset.chatReadingFace;
  }
});

it("Code mode never mounts the outline", async () => {
  using _motion = motion(true);
  using _mode = inMode("code");
  await using _viewport = await wideViewport(1440);
  await using code = await renderTimeline({ ...baseProps(), timelineEntries: turns(5) });
  expect(code.container.querySelector(".one-chat-outline")).toBeNull();
});

it("Chat mode marks the turn under the upper quarter of the view, and the last turn when the thread fits", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const fitting = [
    message("ask-0", "user", "First question"),
    message("answer-0", "assistant", "Short."),
    message("ask-1", "user", "Second question"),
    message("answer-1", "assistant", "Short."),
    message("ask-2", "user", "Third question"),
    message("answer-2", "assistant", "Short."),
  ];
  await using screen = await renderTimeline({ ...baseProps(), timelineEntries: fitting });
  const outline = screen.getByRole("navigation", { name: "In this chat" });
  await expect.element(outline).toBeVisible();
  await vi.waitFor(() =>
    expect(outline.element().querySelector("[aria-current]")?.textContent).toBe("Third question"),
  );
});

it("Chat mode's outline mark does not carry across a thread switch", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const props = baseProps();
  await using screen = await renderTimeline({
    ...props,
    routeThreadKey: "environment-local:thread-first",
    timelineEntries: turns(5),
  });
  const outline = screen.getByRole("navigation", { name: "In this chat" });
  await vi.waitFor(() =>
    expect(outline.element().querySelector("[aria-current]")?.textContent).toBe(
      "Question number 5",
    ),
  );
  await outline.getByRole("button").first().click();
  await vi.waitFor(() =>
    expect(outline.element().querySelector("[aria-current]")?.textContent).toBe(
      "Question number 1",
    ),
  );

  const other = turns(4).map((entry) => ({ ...entry, id: `other-${entry.id}` }) as Entry);
  const renamed = other.map((entry) =>
    entry.kind === "message"
      ? { ...entry, message: { ...entry.message, id: MessageId.make(`other-${entry.message.id}`) } }
      : entry,
  );
  await screen.rerender(
    <MessagesTimeline
      {...props}
      routeThreadKey="environment-local:thread-second"
      timelineEntries={renamed}
    />,
  );
  // The pick made in the first thread is gone: the second thread's own end is marked.
  await vi.waitFor(() =>
    expect(screen.container.querySelector(".one-chat-outline [aria-current]")?.textContent).toBe(
      "Question number 4",
    ),
  );
});

/** The provider turn and native item an approval and its file change share. */
function codexItem(nativeId: string) {
  return {
    providerTurnId: ProviderTurnId.make("turn-1"),
    nativeItemRef: {
      driver: ProviderDriverKind.make("codex"),
      nativeId,
      strength: "strong" as const,
    },
  };
}

/** A file change the agent asks to apply, with its approval pending. */
function fileChangeApprovalFixture() {
  const fixture = makeStreamingTimelineFixture();
  const [, , , user, work] = fixture.visibleTurnItems;
  if (user?.item.type !== "user_message" || work?.item.type !== "dynamic_tool") {
    throw new Error("Expected the live fixture items");
  }
  const requestId = RuntimeRequestId.make("file-approval");
  const change = {
    ...work,
    position: work.position + 1,
    sourceItemId: TurnItemId.make("change-0"),
    item: {
      ...work.item,
      id: TurnItemId.make("change-0"),
      ...codexItem("change-native"),
      type: "file_change" as const,
      status: "completed" as const,
      fileName: "server/src/math.ts",
      additions: 12,
      deletions: 3,
    },
  };
  const request = {
    ...work,
    position: work.position + 2,
    sourceItemId: TurnItemId.make("approval-file"),
    item: {
      ...work.item,
      id: TurnItemId.make("approval-file"),
      ...codexItem("change-native"),
      type: "approval_request" as const,
      status: "waiting" as const,
      requestId,
      requestKind: "file-change" as const,
      prompt: "Changed files",
    },
  };
  const pending: PendingApproval = {
    requestId,
    requestKind: "file-change",
    createdAt: fixture.time(6),
    detail: "Changed files",
    responseCapability: "live",
  };
  return {
    runId: fixture.runId,
    pending,
    entries: deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: [user, change, request],
      optimisticMessages: [],
    }),
    latestRun: {
      runId: fixture.runId,
      status: "running" as const,
      startedAt: fixture.time(5),
      completedAt: null,
    },
  };
}

it.each(["chat", "code"] as const)(
  "a pending file change approval names its file and change counts in %s mode",
  async (mode) => {
    using _mode = inMode(mode);
    const turn = fileChangeApprovalFixture();
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
    const approval = screen.getByRole("group", { name: "File change approval" });
    await expect.element(approval).toBeVisible();
    await expect.element(approval.getByText("math.ts", { exact: true })).toBeVisible();
    expect(approval.element().textContent).toContain("server/src/");
    expect(approval.element().textContent).toContain("+12 −3");
    expect(approval.element().textContent).not.toContain("Changed files");
  },
);

it("Chat mode says Waiting for you while an approval is pending, and Code mode keeps the working line", async () => {
  const turn = turnFixture({ approval: true, finished: false });
  const props = {
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
    isWorking: true,
    runningRunId: turn.runId,
    activeTurnStartedAt: turn.latestRun.startedAt,
    pendingApprovals: [turn.pending],
    awaitingUser: "approval" as const,
    canOperateThread: true,
    onRespondToApproval: async () => {},
  };
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline(props);
    await expect.element(screen.getByText("Waiting for you")).toBeVisible();
    await vi.waitFor(() =>
      expect(screen.container.querySelector("[data-chat-waiting]")?.textContent ?? "").toMatch(
        /Waiting for you\s*·\s*\d/,
      ),
    );
    expect(screen.container.textContent).not.toContain("Working");
    // A turn that waits on the person holds its flat glyph still: nothing is working.
    const mark = screen.container.querySelector<HTMLElement>(
      "[data-chat-waiting] .one-working-mark",
    )!;
    const glyph = mark.querySelector<SVGElement>("svg[data-one-glyph]")!;
    expect(glyph.getAttribute("data-one-glyph")).toBe("16");
    expect(mark.querySelector("img, [data-one-mark-vector]")).toBeNull();
    expect(getComputedStyle(glyph).animationName).toBe("none");
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline(props);
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-timeline-row-kind="working"]')).not.toBeNull(),
    );
    expect(screen.container.textContent).toContain("Working");
    expect(screen.container.textContent).not.toContain("Waiting for you");
  }
});

/** A composer stand-in that records what the follow-up actions put in it. */
function composerStandIn(initial: string) {
  const state = { value: initial, focused: 0, accepts: true };
  const handle = {
    readSnapshot: () => ({ value: state.value }),
    insertTextAtEnd: (text: string) => {
      if (!state.accepts) return false;
      state.value += text;
      return true;
    },
    focusAtEnd: () => {
      state.focused += 1;
    },
  } as unknown as NonNullable<ComponentProps<typeof ComposerHandleContext>["value"]>["current"];
  return { state, ref: { current: handle } };
}

/** The embedded chat's setup: the ancestor's composer context is cleared, the timeline gets its own. */
function followUpScene(composer: ReturnType<typeof composerStandIn>, props: TimelineProps) {
  return (
    <ComposerHandleContext value={null}>
      <MessagesTimeline {...props} composerRef={composer.ref} />
    </ComposerHandleContext>
  );
}

it("Chat mode offers follow-ups under the last finished answer only, and a pick fills the timeline composer when the ancestor composer context is cleared", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  const composer = composerStandIn("");
  const props = { ...baseProps(), timelineEntries: turns(2) };
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  await using screen = await render(followUpScene(composer, props), { container });

  const groups = () => screen.container.querySelectorAll('[role="group"][aria-label="Follow up"]');
  await vi.waitFor(() => expect(groups()).toHaveLength(1));
  expect(groups()[0]!.closest("[data-message-id='answer-1']")).not.toBeNull();
  const followUps = screen.getByRole("group", { name: "Follow up" });
  await expect.element(followUps).toBeVisible();
  expect(
    followUps
      .getByRole("button")
      .elements()
      .map((button) => button.querySelector(".one-chat-followup-title")?.textContent),
  ).toEqual(["Go deeper", "Challenge this", "Quiz me on this"]);

  await followUps.getByRole("button", { name: /^Challenge this/ }).click();
  expect(composer.state.value).toBe("Challenge this: what is the strongest case against it?");
  expect(composer.state.focused).toBe(1);

  // Text the person already wrote stays as it is; the composer is only focused.
  await followUps.getByRole("button", { name: /^Go deeper/ }).click();
  expect(composer.state.value).toBe("Challenge this: what is the strongest case against it?");
  expect(composer.state.focused).toBe(2);
});

it("Chat mode shows no follow-ups while a turn runs, while a request waits, or in Code mode", async () => {
  using _motion = motion(true);
  const composer = composerStandIn("");
  const container = () => {
    const element = document.createElement("div");
    element.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
    return element;
  };
  const readyIn = (screen: { container: HTMLElement }) =>
    screen.container.querySelector<HTMLElement>('[role="group"][aria-label="Follow up"]');
  {
    using _mode = inMode("chat");
    const finished = turnFixture({ approval: false, finished: true });
    await using idle = await render(
      followUpScene(composer, {
        ...baseProps(),
        timelineEntries: finished.entries,
        latestRun: finished.latestRun,
      }),
      { container: container() },
    );
    await vi.waitFor(() => expect(readyIn(idle)?.hasAttribute("data-ready")).toBe(true));

    await using running = await render(
      followUpScene(composer, {
        ...baseProps(),
        timelineEntries: finished.entries,
        latestRun: finished.latestRun,
        isWorking: true,
        runningRunId: finished.runId,
      }),
      { container: container() },
    );
    await vi.waitFor(() => expect(readyIn(running)).not.toBeNull());
    expect(readyIn(running)?.hasAttribute("data-ready")).toBe(false);
    expect(readyIn(running)?.hasAttribute("inert")).toBe(true);

    await using waiting = await render(
      followUpScene(composer, {
        ...baseProps(),
        timelineEntries: finished.entries,
        latestRun: finished.latestRun,
        awaitingUser: "input",
      }),
      { container: container() },
    );
    await vi.waitFor(() => expect(readyIn(waiting)).not.toBeNull());
    expect(readyIn(waiting)?.hasAttribute("data-ready")).toBe(false);
  }
  {
    using _mode = inMode("code");
    await using code = await render(
      followUpScene(composer, { ...baseProps(), timelineEntries: turns(2) }),
      { container: container() },
    );
    await vi.waitFor(() =>
      expect(code.container.querySelector('[data-message-id="answer-1"]')).not.toBeNull(),
    );
    expect(readyIn(code)).toBeNull();
  }
});

it("Chat mode offers no follow-ups when the timeline has no composer to write to", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  await using screen = await render(
    <MessagesTimeline {...baseProps()} timelineEntries={turns(2)} />,
    { container },
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[data-message-id="answer-1"]')).not.toBeNull(),
  );
  expect(screen.container.querySelector('[role="group"][aria-label="Follow up"]')).toBeNull();
});

it("a follow-up does nothing when the composer refuses the text", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  const composer = composerStandIn("");
  composer.state.accepts = false;
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  await using screen = await render(
    followUpScene(composer, { ...baseProps(), timelineEntries: turns(1) }),
    { container },
  );
  await screen.getByRole("button", { name: /^Go deeper/ }).click();
  expect(composer.state.value).toBe("");
  expect(composer.state.focused).toBe(0);
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

/** An answer, then what the run raised after it: a notice and/or a failed turn. */
function noticeFixture(options: { notices?: number; failure?: boolean }) {
  const fixture = makeStreamingTimelineFixture();
  const [, , , user, work, assistant] = fixture.visibleTurnItems;
  if (user?.item.type !== "user_message" || work?.item.type !== "dynamic_tool") {
    throw new Error("Expected the live fixture items");
  }
  if (assistant?.item.type !== "assistant_message") throw new Error("Expected live assistant");
  const answer = {
    ...assistant,
    item: { ...assistant.item, text: "The file is short.", streaming: false, status: "completed" },
  } as typeof assistant;
  const notice = (index: number) =>
    ({
      ...work,
      position: work.position + 10 + index,
      sourceItemId: TurnItemId.make(`notice-${index}`),
      item: {
        ...work.item,
        id: TurnItemId.make(`notice-${index}`),
        type: "system_notice" as const,
        status: "completed" as const,
        level: "warning" as const,
        message: `MCP client for mem${index} timed out after 30 seconds. Add or adjust \`startup_timeout_sec\` in your config to give it longer to start.`,
      },
    }) as unknown as typeof work;
  const failure = {
    ...work,
    position: work.position + 30,
    sourceItemId: TurnItemId.make("failed-turn"),
    item: {
      ...work.item,
      id: TurnItemId.make("failed-turn"),
      type: "error" as const,
      status: "failed" as const,
      failure: {
        class: "provider_error" as const,
        message: "upstream connect error or disconnect/reset before headers (status 503)",
        code: null,
        retryable: false,
      },
    },
  } as unknown as typeof work;
  return deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: [
      user,
      answer,
      ...Array.from({ length: options.notices ?? 0 }, (_, index) => notice(index)),
      ...(options.failure ? [failure] : []),
    ],
    optimisticMessages: [],
  });
}

it("Chat mode folds a turn's notices into one quiet line that opens to the full text, and Code mode keeps each row", async () => {
  const timelineEntries = noticeFixture({ notices: 2 });
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    const line = screen.getByRole("button", { name: "2 notices" });
    await expect.element(line).toBeVisible();
    expect(screen.container.querySelectorAll("[data-chat-notice]")).toHaveLength(1);
    expect(screen.container.textContent).not.toContain("timed out after 30 seconds");

    await line.click();
    await expect.element(line).toHaveAttribute("aria-expanded", "true");
    const texts = [...screen.container.querySelectorAll<HTMLElement>(".one-chat-notice-text")];
    expect(texts.map((text) => text.textContent)).toHaveLength(2);
    for (const text of texts) {
      // Wrapped, never cut off: the whole sentence is there and nothing overflows its box.
      expect(text.textContent).toContain("to give it longer to start.");
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
    }
    await expect.element(screen.getByRole("button", { name: "Copy notice text" })).toBeVisible();
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await vi.waitFor(() =>
      expect(screen.container.querySelectorAll('[data-v2-item-type="system_notice"]')).toHaveLength(
        2,
      ),
    );
    expect(screen.container.querySelector("[data-chat-notice]")).toBeNull();
  }
});

it("Chat mode says a failed turn in one plain sentence with the technical text behind a disclosure, and Code mode shows the text at once", async () => {
  const timelineEntries = noticeFixture({ failure: true });
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    const alert = screen.getByRole("alert");
    await expect.element(alert).toBeVisible();
    expect(alert.element().textContent).toContain("This turn stopped before it could answer.");
    expect(screen.container.textContent).not.toContain("upstream connect error");

    await screen.getByRole("button", { name: "Technical details" }).click();
    const detail = screen.container.querySelector<HTMLElement>(".one-chat-notice-text")!;
    expect(detail.textContent).toContain("upstream connect error or disconnect/reset");
    expect(detail.scrollWidth).toBeLessThanOrEqual(detail.clientWidth);
    await expect
      .element(screen.getByRole("button", { name: "Copy technical details" }))
      .toBeVisible();
    // The sentence is set in the answer's own face.
    expect(
      getComputedStyle(screen.container.querySelector(".one-chat-failure-headline")!).fontFamily,
    ).toBe(getComputedStyle(document.documentElement).getPropertyValue("--one-serif").trim());
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await expect.element(screen.getByText(/upstream connect error/)).toBeVisible();
    expect(screen.container.querySelector("[data-chat-failure]")).toBeNull();
  }
});

it("Chat mode sets a lone image as a figure with its alt text as the caption, and Code mode shows no caption", async () => {
  const entries = [
    message("ask", "user", "Show me"),
    message(
      "answer",
      "assistant",
      "Here it is.\n\n![A third order lens, seen from the side](http://localhost:1/lens.png)\n\nIn a sentence ![inline](http://localhost:1/dot.png) it has none.",
    ),
  ];
  const captionOf = (screen: { container: HTMLElement }) =>
    screen.container.querySelectorAll<HTMLElement>("[data-one-figure-caption]");
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries: entries });
    await vi.waitFor(() => expect(captionOf(screen)).toHaveLength(1));
    const caption = captionOf(screen)[0]!;
    expect(caption.textContent).toBe("A third order lens, seen from the side");
    expect(getComputedStyle(caption).display).toBe("block");
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries: entries });
    await vi.waitFor(() => expect(captionOf(screen)).toHaveLength(1));
    expect(getComputedStyle(captionOf(screen)[0]!).display).toBe("none");
  }
});

it("Chat mode reveals a new answer one paragraph after another, and the reveal is gone with the marker", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  const props = baseProps();
  const opening = [
    message("ask-1", "user", "First question"),
    message("answer-1", "assistant", "First one.\n\nSecond one.\n\nThird one."),
  ];
  await using screen = await renderTimeline({ ...props, timelineEntries: opening });
  const paragraphsOf = (id: string) => [
    ...screen.container.querySelectorAll<HTMLElement>(
      `[data-message-id="${id}"] .chat-markdown > p`,
    ),
  ];
  await vi.waitFor(() => expect(paragraphsOf("answer-1")).toHaveLength(3));
  expect(paragraphsOf("answer-1").map((p) => getComputedStyle(p).animationName)).toEqual([
    "none",
    "none",
    "none",
  ]);

  await screen.rerender(
    <MessagesTimeline
      {...props}
      timelineEntries={[
        ...opening,
        message("ask-2", "user", "Next question"),
        message("answer-2", "assistant", "Alpha.\n\nBeta.\n\nGamma."),
      ]}
    />,
  );
  await vi.waitFor(() => expect(arrivals(screen.container)).toEqual(["answer-2"]));
  const arrived = paragraphsOf("answer-2");
  expect(arrived.map((p) => getComputedStyle(p).animationName)).toEqual([
    "one-chat-reveal",
    "one-chat-reveal",
    "one-chat-reveal",
  ]);
  expect(arrived.map((p) => getComputedStyle(p).animationDelay)).toEqual(["0s", "0.08s", "0.16s"]);
  // The answer already on screen never plays it.
  expect(paragraphsOf("answer-1").map((p) => getComputedStyle(p).animationName)).toEqual([
    "none",
    "none",
    "none",
  ]);

  const row = screen.container.querySelector<HTMLElement>('[data-message-id="answer-2"]')!;
  await act(async () => {
    row.dispatchEvent(
      new AnimationEvent("animationend", { animationName: "one-chat-arrive", bubbles: true }),
    );
  });
  await vi.waitFor(() =>
    expect(paragraphsOf("answer-2").map((p) => getComputedStyle(p).animationName)).toEqual([
      "none",
      "none",
      "none",
    ]),
  );
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
