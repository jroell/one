import {
  MessageId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  TurnItemId,
} from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { deriveTimelineEntriesFromVisibleTurnItems, type PendingApproval } from "~/session-logic";
import { makeStreamingTimelineFixture } from "~/test-fixtures";
import { act, fakeTimers, render } from "../../test/render";
import { ComposerHandleContext } from "~/composerHandleContext";
import { CHAT_STAGE_HOLD_MS } from "./chatStage";
import { ChatStatusDot } from "./ChatStatusDot";
import { QUIZ_INSTRUCTIONS } from "./chatQuiz";
import { ComposerContextPermissions } from "~/components/ComposerContextPermissions";
import { ComposerFooterModeControls } from "~/components/chat/ComposerFooterControls";
import { resolveRuntimeModeOption, runtimeModeOptions } from "~/components/chat/runtimeModeConfig";
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

/** The timeline with the header's status dot beside it, as the app lays them out. */
async function renderTimelineWithStatus(props: TimelineProps) {
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  return render(
    <>
      <ChatStatusDot />
      <MessagesTimeline {...props} />
    </>,
    { container },
  );
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
    item: {
      ...assistant.item,
      text: "The file is short. It holds one function.",
      streaming: false,
      status: "completed",
    },
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

it("Chat mode hides a finished turn's tool rows behind one quiet plain line that opens to the rows", async () => {
  using _mode = inMode("chat");
  const turn = turnFixture({ approval: false, finished: true });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
  });

  const disclosure = screen.getByRole("button", { name: /^(Looked at 1 source|Took 1 step)/ });
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(screen.container.querySelectorAll('[data-timeline-row-kind="turn-fold"]')).toHaveLength(1);
  expect(screen.container.textContent).not.toContain("index.ts");

  await disclosure.click();
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText(/index\.ts/).first()).toBeVisible();
});

it("Chat mode sets an answer that used tools in the serif, with the work log closed or open", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const turn = turnFixture({ approval: false, finished: true });
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
  });
  const answerFace = () =>
    getComputedStyle(
      screen.container.querySelector<HTMLElement>(
        '[data-message-role="assistant"] .chat-markdown',
      )!,
    ).fontFamily;
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector('[data-message-role="assistant"] .chat-markdown'),
    ).not.toBeNull(),
  );
  expect(answerFace()).toContain("Iowan Old Style");
  await screen.getByRole("button", { name: /^(Looked at 1 source|Took 1 step)/ }).click();
  expect(answerFace()).toContain("Iowan Old Style");
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
  await using _viewport = await wideViewport(1440);
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
  // A 20px face on a 32px line on a laptop; a phone gets 17px so the line still holds a reading measure.
  expect(Number.parseFloat(getComputedStyle(answer).fontSize)).toBe(20);
  expect(Number.parseFloat(getComputedStyle(answer).lineHeight)).toBe(32);
  await page.viewport(390, 900);
  expect(Number.parseFloat(getComputedStyle(answer).fontSize)).toBeCloseTo(17.1, 0);
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

it("Chat mode shows the outline from the first turn on a wide screen, but none in a narrow timeline or a short one, where the minimap stays", async () => {
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
    await using single = await outlineIn(1, wide);
    await expect.element(single.getByRole("navigation", { name: "In this chat" })).toBeVisible();
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
  const scroller = list.getScrollableNode() as HTMLElement;
  // A scroll target past the measured content clamps to the end, where the outline reads nothing.
  await vi.waitFor(() =>
    expect(scroller.scrollHeight - scroller.clientHeight).toBeGreaterThan(1500 + 200),
  );
  using _timers = fakeTimers();
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
    // The dock itself is solid, so no line of the answer shows beside or under the composer. The
    // room's light is drawn on a layer inside it, never by thinning it.
    expect(getComputedStyle(dock).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(dock).isolation).toBe("isolate");
    expect(getComputedStyle(dock, "::before").position).toBe("absolute");
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
    if (mode === "chat") {
      // Chat asks in a sentence; what would change waits behind one quiet link.
      const sentence = screen.container.querySelector(".one-chat-approval-sentence")!;
      expect(sentence.textContent).toBe("Change server/src/math.ts: 12 lines added, 3 removed?");
      await expect.element(approval.getByText("math.ts", { exact: true })).not.toBeVisible();
      await screen.getByRole("button", { name: "Show change" }).click();
    }
    await expect.element(approval.getByText("math.ts", { exact: true })).toBeVisible();
    expect(approval.element().textContent).toContain("server/src/");
    expect(approval.element().textContent).toContain("+12 −3");
    expect(approval.element().textContent).not.toContain("Changed files");
  },
);

it("Chat mode takes the permissions chips out of the composer, and Code mode keeps them", async () => {
  const chip = (screen: { container: HTMLElement }) =>
    screen.container.querySelector<HTMLElement>("[data-composer-permissions]")!;
  for (const [mode, shown] of [
    ["chat", false],
    ["code", true],
  ] as const) {
    using _mode = inMode(mode);
    await using screen = await render(
      <ComposerContextPermissions
        environmentId={null}
        runtimeMode="approval-required"
        supportedRuntimeModes={["approval-required", "full-access"]}
        onRuntimeModeChange={() => {}}
      />,
      { router: false },
    );
    await vi.waitFor(() => expect(chip(screen)).not.toBeNull());
    expect(chip(screen).getAttribute("aria-label")).toBe("Permissions: Supervised");
    expect(getComputedStyle(chip(screen)).display === "none", mode).toBe(!shown);
  }
  // The footer's chip (the one that says "Supervised" and opens with the composer) goes too.
  for (const [mode, shown] of [
    ["chat", false],
    ["code", true],
  ] as const) {
    using _mode = inMode(mode);
    await using screen = await render(
      <ComposerFooterModeControls
        runtimeMode="approval-required"
        runtimeModeOptions={runtimeModeOptions.map((option) => resolveRuntimeModeOption(option))}
        accessDisplay="label"
        onRuntimeModeChange={() => {}}
      />,
      { router: false },
    );
    await vi.waitFor(() => expect(chip(screen)).not.toBeNull());
    expect(chip(screen).textContent).toContain("Supervised");
    expect(getComputedStyle(chip(screen)).display === "none", mode).toBe(!shown);
  }
});

it("Chat mode asks for an approval in one sentence that names what is asked, with Approve and Decline under it at the left edge", async () => {
  const sentenceOf = (screen: { container: HTMLElement }) =>
    screen.container.querySelector<HTMLElement>(".one-chat-approval-sentence")!;
  const run = (
    turn: ReturnType<typeof turnFixture> | ReturnType<typeof fileChangeApprovalFixture>,
  ) => ({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
    isWorking: true,
    runningRunId: turn.runId,
    pendingApprovals: [turn.pending],
    canOperateThread: true,
    onRespondToApproval: async () => {},
  });
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  {
    await using screen = await renderTimeline(run(fileChangeApprovalFixture()));
    await vi.waitFor(() => expect(sentenceOf(screen)).toBeDefined());
    expect(sentenceOf(screen).textContent).toBe(
      "Change server/src/math.ts: 12 lines added, 3 removed?",
    );
    await expect.element(screen.getByRole("button", { name: /Approve/ }).first()).toBeVisible();
    await expect.element(screen.getByRole("button", { name: /Decline/ }).first()).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Show change" })).toBeVisible();
    await expect.element(screen.getByText("Needs approval")).not.toBeVisible();
    // No empty slab: the buttons sit under the sentence, starting at its left edge.
    const approve = screen
      .getByRole("button", { name: /Decline/ })
      .first()
      .element();
    const left = sentenceOf(screen).getBoundingClientRect().left;
    const footer = screen.container.querySelector<HTMLElement>("[data-approval-footer]")!;
    expect(footer.getBoundingClientRect().left).toBeLessThanOrEqual(left + 1);
    expect(approve.getBoundingClientRect().top).toBeGreaterThan(
      sentenceOf(screen).getBoundingClientRect().bottom,
    );
    const buttons = [...footer.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    // Decline starts at the sentence's own left edge: the menu of other answers follows the buttons.
    expect(Math.abs(Math.min(...buttons.map((box) => box.left)) - left)).toBeLessThanOrEqual(2);
    // The path is set in the sentence's own serif, in italic, so the line has one face for words.
    const path = sentenceOf(screen).querySelector<HTMLElement>(".one-chat-approval-path")!;
    expect(path.textContent).toBe("server/src/math.ts");
    expect(getComputedStyle(path).fontStyle).toBe("italic");
    expect(getComputedStyle(path).fontFamily).toBe(getComputedStyle(sentenceOf(screen)).fontFamily);
    expect(
      getComputedStyle(screen.container.querySelector("[data-approval-card]")!).backgroundColor,
    ).toBe("rgba(0, 0, 0, 0)");
  }
  {
    const command = turnFixture({ approval: true, finished: false });
    await using screen = await renderTimeline(run(command));
    await vi.waitFor(() => expect(sentenceOf(screen)).toBeDefined());
    expect(sentenceOf(screen).textContent).toBe("Run git status?");
    expect(sentenceOf(screen).querySelector("code")?.textContent).toBe("git status");
  }
  {
    using _code = inMode("code");
    await using screen = await renderTimeline(
      run(turnFixture({ approval: true, finished: false })),
    );
    await expect.element(screen.getByText("Needs approval")).toBeVisible();
    expect(screen.container.querySelector("[data-chat-approval]")).toBeNull();
  }
});

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
    // The one state that needs the person has the attention colour, as a still dot, and no mark.
    const dot = screen.container.querySelector<HTMLElement>(
      "[data-chat-waiting] .one-chat-waiting-dot",
    )!;
    const attention = document.createElement("span");
    attention.style.background = "var(--st-attention)";
    document.body.append(attention);
    expect(getComputedStyle(dot).backgroundColor).toBe(getComputedStyle(attention).backgroundColor);
    attention.remove();
    expect(getComputedStyle(dot).animationName).toBe("none");
    expect(screen.container.querySelector("[data-chat-waiting] :is(svg, img)")).toBeNull();
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

it("Chat mode marks a working turn with the gold working arc and no lit mark", async () => {
  const turn = turnFixture({ approval: false, finished: false });
  using _mode = inMode("chat");
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: turn.entries,
    latestRun: turn.latestRun,
    isWorking: true,
    runningRunId: turn.runId,
    activeTurnStartedAt: turn.latestRun.startedAt,
  });
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-working-arc]")).not.toBeNull(),
  );
  expect(screen.container.querySelector("img, [data-one-mark-vector]")).toBeNull();
  expect(screen.container.querySelector("svg.one-mark, [data-one-mark]")).toBeNull();
});

const QUESTION = "Why does a lighthouse lens look like a set of rings?";

function stageProps() {
  return {
    ...baseProps(),
    timelineEntries: [message("ask-stage", "user", QUESTION)],
    isWorking: true,
    activeTurnStartedAt: CREATED_AT,
  };
}

it("Chat mode shows the waiting stage under the question after 250ms, with a 32px arc, the question not repeated and no placeholder bars", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  await using _viewport = await wideViewport(1440);
  await using screen = await renderTimeline(stageProps());
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-chat-stage]")).not.toBeNull(),
  );
  // The person's own message is already on screen above it: the stage does not say it again.
  expect(screen.container.querySelector("[data-chat-stage]")!.textContent).not.toContain(QUESTION);
  expect(screen.container.querySelector(".one-chat-stage-question")).toBeNull();
  const arc = screen.container.querySelector<HTMLElement>(".one-chat-stage [data-working-arc]")!;
  expect(arc.getBoundingClientRect().width).toBe(32);
  // No grey placeholder bars, and nothing is drawn until 250ms: a quick answer shows no stage.
  expect(screen.container.querySelector(".one-chat-stage-lines")).toBeNull();
  expect(
    getComputedStyle(screen.container.querySelector("[data-chat-stage]")!).animationDelay,
  ).toBe("0.25s");
  // The stage has its own arc and timer, so the quiet working line is not shown beside it.
  expect(
    screen.container.querySelector('[data-timeline-row-kind="working"] .one-working-arc'),
  ).toBeNull();
  // Code mode keeps its working line and shows no stage.
});

it("Chat mode shows no stage in Code mode, none while a request waits on the person, and none after it is answered", async () => {
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline(stageProps());
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-timeline-row-kind="working"]')).not.toBeNull(),
    );
    expect(screen.container.querySelector("[data-chat-stage]")).toBeNull();
  }
  {
    using _mode = inMode("chat");
    const props = stageProps();
    await using screen = await renderTimeline({ ...props, awaitingUser: "input" });
    await expect.element(screen.getByText("Waiting for you")).toBeVisible();
    expect(screen.container.querySelector("[data-chat-stage]")).toBeNull();
    // Once the person has answered, the turn has begun: the stage does not come back for it.
    await screen.rerender(<MessagesTimeline {...props} />);
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-timeline-row-kind="working"]')).not.toBeNull(),
    );
    expect(screen.container.querySelector("[data-chat-stage]")).toBeNull();
  }
});

it("Chat mode hands the stage to the answer by a cross-fade with nothing moving: the answer sits where it will rest, and the stage leaves after its hold", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  await using _viewport = await wideViewport(1440);
  const props = stageProps();
  const answered = [...props.timelineEntries, message("answer-stage", "assistant", "Because.")];
  const answerTop = (screen: { container: HTMLElement }) =>
    screen.container
      .querySelector<HTMLElement>('[data-message-id="answer-stage"]')!
      .getBoundingClientRect().top;
  // Where the answer rests when no stage was ever shown.
  let restingTop = 0;
  {
    await using resting = await renderTimeline({
      ...props,
      timelineEntries: answered,
    });
    await vi.waitFor(() =>
      expect(resting.container.querySelector('[data-message-id="answer-stage"]')).not.toBeNull(),
    );
    restingTop = answerTop(resting);
  }
  await using screen = await renderTimeline(props);
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-chat-stage]")).not.toBeNull(),
  );
  const stage = () => screen.container.querySelector<HTMLElement>("[data-chat-stage]");
  const ghost = () => screen.container.querySelector<HTMLElement>(".one-chat-stage-ghost");
  // Only a shown stage leaves a ghost, and it counts as shown when React has handled the
  // entrance's `animationstart`, which comes a frame after the animation's opacity first moves.
  await vi.waitFor(() => expect(stage()?.hasAttribute("data-shown")).toBe(true));
  const stageTop = stage()!.getBoundingClientRect().top;
  expect(stage()!.getBoundingClientRect().height).toBeGreaterThan(28);

  using _timers = fakeTimers();
  await screen.rerender(<MessagesTimeline {...props} timelineEntries={answered} />);
  // One millisecond a poll, so the wait does not eat into the stage's hold.
  await vi.waitFor(() => expect(stage()?.hasAttribute("data-leaving")).toBe(true), {
    interval: 1,
  });
  // It takes no room, so the answer is already where it will rest, with the stage fading over it.
  expect(stage()!.getBoundingClientRect().height).toBe(0);
  expect(Math.abs(answerTop(screen) - restingTop)).toBeLessThan(2);
  // Its picture fades where it stood, on a layer over the timeline that no row clips.
  expect(ghost()).not.toBeNull();
  expect(Math.abs(ghost()!.getBoundingClientRect().top - stageTop)).toBeLessThan(2);
  expect(getComputedStyle(ghost()!).visibility).toBe("visible");
  // The picture and the answer's first words cross-fade over the same 180ms, both linear, so at
  // every frame their opacities add up to one and the column is never empty.
  const fade = getComputedStyle(ghost()!);
  const answerFirst = getComputedStyle(
    screen.container.querySelector<HTMLElement>(
      '[data-message-id="answer-stage"] .chat-markdown > p',
    )!,
  );
  expect(fade.animationName).toBe("one-chat-stage-out");
  expect(answerFirst.animationName).toBe("one-chat-handoff-in");
  expect(answerFirst.animationDuration).toBe(fade.animationDuration);
  expect(answerFirst.animationDelay).toBe(fade.animationDelay);
  expect(answerFirst.animationTimingFunction).toBe(fade.animationTimingFunction);
  expect(fade.animationTimingFunction).toBe("linear");

  await act(() => vi.advanceTimersByTime(CHAT_STAGE_HOLD_MS / 2));
  expect(stage()).not.toBeNull();
  // The list renders its rows on its own frame after the hold ends.
  await act(() => vi.advanceTimersByTime(1500));
  expect(stage()).toBeNull();
  expect(ghost()).toBeNull();
  expect(Math.abs(answerTop(screen) - restingTop)).toBeLessThan(2);
});

it("Chat mode builds an answer that arrives whole: headings first, then the sections, and a gold line under at most three key terms", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  await using _viewport = await wideViewport(1440);
  const ask = message("ask-build", "user", "How does a Fresnel lens work?");
  const props = { ...baseProps(), timelineEntries: [ask] };
  await using screen = await renderTimeline(props);
  const answer = [
    "## Why **rings** work",
    "A **Fresnel lens** bends light by **refraction** at each ring.",
    "## What changes",
    "Each zone sets a **slope** and a **pitch**, and nothing more.",
    "**Rings keep the glass thin.**",
  ].join("\n\n");
  await screen.rerender(
    <MessagesTimeline
      {...props}
      timelineEntries={[ask, message("answer-build", "assistant", answer)]}
    />,
  );
  const root = () =>
    screen.container.querySelector<HTMLElement>('[data-message-id="answer-build"] .chat-markdown');
  await vi.waitFor(() => expect(root()?.querySelector("strong[data-key-term]")).not.toBeNull());
  const index = (element: Element) =>
    Number.parseInt((element as HTMLElement).style.getPropertyValue("--one-reveal-index"), 10);
  const [first, firstBody, second, secondBody] = [...root()!.children];
  // Both headings come before any paragraph, and the paragraphs keep their own order.
  expect([index(first!), index(second!)]).toEqual([0, 1]);
  expect(index(firstBody!)).toBe(2);
  expect(index(secondBody!)).toBe(3);
  // Three terms at most, in the running text: not the heading's bold, not the bold statement.
  expect(
    [...root()!.querySelectorAll("strong[data-key-term]")].map((term) => term.textContent),
  ).toEqual(["Fresnel lens", "refraction", "slope"]);
  const term = root()!.querySelector<HTMLElement>("strong[data-key-term]")!;
  expect(getComputedStyle(term).animationName).toBe("one-chat-term-draw");
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

it("Chat mode shows the words a follow-up will send, in place of its hint, when it is hovered or focused", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  const composer = composerStandIn("");
  const props = { ...baseProps(), timelineEntries: turns(2) };
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  await using screen = await render(followUpScene(composer, props), { container });
  const followUps = screen.getByRole("group", { name: "Follow up" });
  await expect.element(followUps).toBeVisible();
  const quiz = followUps.getByRole("button", { name: /^Quiz me on this/ });
  const part = (name: string) =>
    quiz.element().querySelector<HTMLElement>(`.one-chat-followup-${name}`)!;
  expect(getComputedStyle(part("hint")).opacity).toBe("1");
  expect(getComputedStyle(part("preview")).opacity).toBe("0");

  await quiz.hover();
  await vi.waitFor(() => expect(getComputedStyle(part("preview")).opacity).toBe("1"));
  expect(getComputedStyle(part("hint")).opacity).toBe("0");
  // The person reads what they are asking for, not the JSON shape the reading view needs.
  expect(part("preview").textContent).toBe(
    "Quiz me on what you just explained, with three questions.",
  );

  // Keyboard focus shows the same words.
  await userEvent.unhover(quiz.element());
  await vi.waitFor(() => expect(getComputedStyle(part("preview")).opacity).toBe("0"));
  const challenge = followUps.getByRole("button", { name: /^Challenge this/ });
  quiz.element().focus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await vi.waitFor(() =>
    expect(
      getComputedStyle(
        challenge.element().querySelector<HTMLElement>(".one-chat-followup-preview")!,
      ).opacity,
    ).toBe("1"),
  );
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

it("Chat mode lists an answer's headings under its turn as they stream, ticking each one that is finished", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const props = baseProps();
  const opening = turns(2);
  const ask = message("ask-live", "user", "Explain the lens");
  const answer = (text: string, streaming: boolean): Entry => {
    const entry = message("answer-live", "assistant", text);
    return entry.kind === "message"
      ? { ...entry, message: { ...entry.message, streaming } }
      : entry;
  };
  const body = "## Rings\n\nA few rings.\n\n## Steps\n\nThree steps.\n\n## Wra";
  await using screen = await renderTimeline({
    ...props,
    timelineEntries: [...opening, ask, answer(body, true)],
  });
  const sections = () => [
    ...screen.container.querySelectorAll<HTMLElement>(".one-chat-outline-section"),
  ];
  await vi.waitFor(() => expect(sections()).toHaveLength(2));
  expect(sections().map((section) => section.textContent)).toEqual(["Rings", "Steps"]);
  // Rings is finished (Steps follows it); Steps is still arriving; "Wra" is not a heading yet.
  expect(sections().map((section) => section.hasAttribute("data-complete"))).toEqual([true, false]);
  expect(
    screen.container.querySelectorAll('.one-chat-outline-tick[aria-label="Section finished"]'),
  ).toHaveLength(1);

  await screen.rerender(
    <MessagesTimeline
      {...props}
      timelineEntries={[...opening, ask, answer(`${body}pping up\n\nDone.`, false)]}
    />,
  );
  await vi.waitFor(() => expect(sections()).toHaveLength(3));
  expect(sections().every((section) => section.hasAttribute("data-complete"))).toBe(true);
});

it("Chat mode gives the follow-ups no room while the answer streams, and a row each once the turn ends", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const props = baseProps();
  const entries = [
    message("ask-f", "user", "Why?"),
    message("answer-f", "assistant", "Because it is small. It needs nothing more."),
  ];
  const followups = (screen: { container: HTMLElement }) =>
    screen.container.querySelector<HTMLElement>(".one-chat-followups");
  const sceneIn = async (extra: Partial<TimelineProps>) => {
    const container = document.createElement("div");
    container.style.cssText =
      "height: 700px; width: 1184px; display: flex; flex-direction: column;";
    return render(
      followUpScene(composerStandIn(""), { ...props, timelineEntries: entries, ...extra }),
      { container },
    );
  };
  {
    await using running = await sceneIn({ isWorking: true });
    await vi.waitFor(() => expect(followups(running)).not.toBeNull());
    expect(followups(running)!.getBoundingClientRect().height).toBe(0);
  }
  {
    await using idle = await sceneIn({});
    await vi.waitFor(() => expect(followups(idle)?.hasAttribute("data-ready")).toBe(true));
    expect(followups(idle)!.getBoundingClientRect().height).toBeGreaterThan(60);
  }
});

it("Chat mode follows a one-line answer with nothing, an answer that asks with replies in place of the three follow-ups, and any other answer with the three", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const sceneFor = async (answer: string) => {
    const container = document.createElement("div");
    container.style.cssText =
      "height: 700px; width: 1184px; display: flex; flex-direction: column;";
    return render(
      followUpScene(composerStandIn(""), {
        ...baseProps(),
        timelineEntries: [
          message("ask-e", "user", "Why?"),
          message("answer-e", "assistant", answer),
        ],
      }),
      { container },
    );
  };
  {
    await using none = await sceneFor("The command printed one JSON line.");
    await vi.waitFor(() =>
      expect(none.container.querySelector('[data-message-id="answer-e"]')).not.toBeNull(),
    );
    expect(none.container.querySelector(".one-chat-followups")).toBeNull();
  }
  {
    await using asked = await sceneFor(
      "You have one account signed in here. That is enough for Usage.\n\nDo you have a second account?",
    );
    await vi.waitFor(() =>
      expect(asked.container.querySelector(".one-chat-replies")?.hasAttribute("data-ready")).toBe(
        true,
      ),
    );
    const replies = [...asked.container.querySelectorAll(".one-chat-replies button")].map(
      (button) => button.textContent,
    );
    expect(replies).toEqual(["Yes", "No", "Not sure"]);
    expect(asked.container.querySelector('[aria-label="Follow up"]')).toBeNull();
  }
  {
    await using plain = await sceneFor("A hub pools accounts. One address serves all of them.");
    await vi.waitFor(() =>
      expect(plain.container.querySelector('[aria-label="Follow up"]')).not.toBeNull(),
    );
    expect(plain.container.querySelector(".one-chat-replies")).toBeNull();
  }
});

it.each([1440, 390] as const)(
  "Chat mode leaves the answer's last line where it was when the turn ends and the follow-ups open beneath it, at %ipx wide",
  async (width) => {
    using _mode = inMode("chat");
    using _motion = motion(true);
    await using _viewport = await wideViewport(width);
    const props = baseProps();
    const entries = turns(3);
    const container = document.createElement("div");
    container.style.cssText = `height: 700px; width: ${Math.min(width, 1184)}px; display: flex; flex-direction: column;`;
    const scene = (isWorking: boolean) =>
      followUpScene(composerStandIn(""), { ...props, timelineEntries: entries, isWorking });
    // The list settles at its end on its own frames, as it has long done by the time a turn ends.
    using _timers = fakeTimers();
    await using screen = await render(scene(true), { container });
    const lastLine = () =>
      screen.container
        .querySelector<HTMLElement>('[data-message-id="answer-2"] .chat-markdown > p:last-child')
        ?.getBoundingClientRect().bottom;
    const followups = () => screen.container.querySelector<HTMLElement>(".one-chat-followups");
    await act(() => vi.advanceTimersByTime(3000));
    const scroller = screen.container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
    expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(2);
    const before = lastLine()!;
    expect(followups()!.getBoundingClientRect().height).toBe(0);

    await screen.rerender(scene(false));
    // The list renders and measures on its own frames; give it a second and a half of them.
    await act(() => vi.advanceTimersByTime(1500));
    expect(followups()!.getBoundingClientRect().height).toBeGreaterThan(60);
    expect(followups()!.hasAttribute("data-ready")).toBe(true);
    expect(Math.abs(lastLine()! - before)).toBeLessThan(1);
  },
);

it("Chat mode holds the answer still while the follow-ups open, and follows a message that arrives while they do", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  await using _viewport = await wideViewport(1440);
  const props = baseProps();
  const entries = turns(3);
  const container = document.createElement("div");
  container.style.cssText = "height: 700px; width: 1184px; display: flex; flex-direction: column;";
  const scene = (timelineEntries: Entry[], isWorking: boolean) =>
    followUpScene(composerStandIn(""), { ...props, timelineEntries, isWorking });
  // The list settles at its end under fake frames, as it has long done by the time a turn ends;
  // the rest of the test runs in real time, which is what the follow-ups' entrance is measured in.
  using _settling = fakeTimers();
  await using screen = await render(scene(entries, true), { container });
  const scroller = () => screen.container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
  const gapToEnd = () => scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight;
  const lastLine = () =>
    screen.container
      .querySelector<HTMLElement>('[data-message-id="answer-2"] .chat-markdown > p:last-child')
      ?.getBoundingClientRect().bottom;
  const followups = () => screen.container.querySelector<HTMLElement>(".one-chat-followups");
  await act(() => vi.advanceTimersByTime(3000));
  expect(gapToEnd()).toBeLessThan(2);
  vi.useRealTimers();
  const before = lastLine()!;

  await screen.rerender(scene(entries, false));
  await vi.waitFor(() => expect(followups()!.getBoundingClientRect().height).toBeGreaterThan(60));
  // The follow-ups are still arriving (their entrance has not finished) and the answer has not moved.
  expect(Math.abs(lastLine()! - before)).toBeLessThan(1);
  expect(gapToEnd()).toBeGreaterThan(40);

  // A message arrives inside that window: the hold ends and the list follows it to the end.
  const next = [
    ...entries,
    message("ask-late", "user", "And one more thing"),
    message("answer-late", "assistant", "Noted."),
  ];
  await screen.rerender(scene(next, false));
  await vi.waitFor(() => expect(gapToEnd()).toBeLessThan(2));
  expect(screen.container.querySelector('[data-message-id="answer-late"]')).not.toBeNull();
});

const BROKEN_IMAGE = "![A drawing of the lens from the side](http://localhost:1/lens-side.png)";

it("Chat mode keeps a picture that failed as a 64px row with its alt text as a serif caption and a Retry button, and Code mode keeps its chip", async () => {
  const entries = [
    message("ask-i", "user", "Show me"),
    message("answer-i", "assistant", BROKEN_IMAGE),
  ];
  {
    using _mode = inMode("chat");
    using _motion = motion(true);
    await using _viewport = await wideViewport(1440);
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries: entries });
    await vi.waitFor(() =>
      expect(screen.container.querySelector("[data-chat-image-failure]")).not.toBeNull(),
    );
    const frame = screen.container.querySelector<HTMLElement>(".one-chat-image-failure-frame")!;
    expect(frame.getBoundingClientRect().height).toBe(64);
    const caption = screen.container.querySelector<HTMLElement>(".one-chat-image-failure-caption")!;
    expect(caption.textContent).toBe("A drawing of the lens from the side");
    expect(getComputedStyle(caption).fontFamily).toContain("Iowan Old Style");
    // The figure's own caption would repeat the alt text.
    for (const figureCaption of screen.container.querySelectorAll("[data-one-figure-caption]")) {
      expect(getComputedStyle(figureCaption).display).toBe("none");
    }
    const retry = screen.getByRole("button", { name: "Retry" });
    await expect.element(retry).toBeVisible();
    // Retry tries the picture again, which fails again here: the frame comes back.
    await retry.click();
    await vi.waitFor(() =>
      expect(screen.container.querySelector("[data-chat-image-failure]")).not.toBeNull(),
    );
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries: entries });
    await vi.waitFor(() => expect(screen.container.textContent).toContain("Image unavailable"));
    expect(screen.container.querySelector("[data-chat-image-failure]")).toBeNull();
  }
});

const DIAGRAM =
  "```mermaid\nflowchart LR\n  A[Lamp] --> B(Fresnel lens)\n  B --> C{Rings aligned?}\n  C -->|yes| D[Narrow beam]\n  C -->|no| E[Scattered light]\n```";

it("Chat mode draws a diagram in the house style: gold 1.5px strokes, serif labels of 14px or more that fit their nodes, edges drawn on in turn", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  await using _viewport = await wideViewport(1440);
  const entries = [
    message("ask-d", "user", "How does it work?"),
    message("answer-d", "assistant", DIAGRAM),
  ];
  await using screen = await renderTimeline({ ...baseProps(), timelineEntries: entries });
  await vi.waitFor(() => expect(screen.container.querySelector(".pele-edge")).not.toBeNull(), {
    timeout: 15_000,
  });
  const edge = screen.container.querySelector<SVGPathElement>(
    ".pele-edge > path:not(.pele-marker)",
  )!;
  expect(getComputedStyle(edge).strokeWidth).toBe("1.5px");
  const gold = getComputedStyle(document.documentElement).getPropertyValue("--gold-400").trim();
  expect(gold).not.toBe("");
  const labels = [...screen.container.querySelectorAll<SVGTextElement>(".pele-label")];
  expect(labels.length).toBeGreaterThanOrEqual(5);
  for (const label of labels) {
    const style = getComputedStyle(label);
    expect(style.fontFamily, label.textContent ?? "").toContain("Iowan Old Style");
    const svg = label.ownerSVGElement!;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    expect(Number.parseFloat(style.fontSize) * scale).toBeGreaterThanOrEqual(14);
    // Nothing is clipped: the label sits inside its node's shape.
    const node = label.closest(".pele-node")!.querySelector<SVGGraphicsElement>("rect, polygon")!;
    expect(label.getBBox().width).toBeLessThanOrEqual(node.getBBox().width);
  }
  const edges = [...screen.container.querySelectorAll<SVGGElement>(".pele-edge")];
  expect(edges.map((group) => group.style.getPropertyValue("--edge-i"))).toEqual(
    edges.map((_, index) => String(index)),
  );
  expect(edge.getAttribute("pathLength")).toBe("1");
  expect(getComputedStyle(edge).animationName).toBe("one-chat-edge-draw");
});

const EDGE_KINDS_DIAGRAM =
  "```mermaid\nflowchart LR\n  A[Solid] --> B[Dotted]\n  B -.-> C[Thick]\n  C ==> D[Open]\n  D --- E[End]\n  linkStyle 0 stroke-dasharray: 4 4\n```";

it("Chat mode keeps a dotted edge dotted and a thick edge thick through the draw-on and after it, with motion and with reduced motion", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  await using _viewport = await wideViewport(1440);
  onTestFinished(async () => {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  });
  for (const reduced of [false, true]) {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
    });
    await using screen = await renderTimeline({
      ...baseProps(),
      timelineEntries: [
        message("ask-e", "user", "Which steps are optional?"),
        message("answer-e", "assistant", EDGE_KINDS_DIAGRAM),
      ],
    });
    await vi.waitFor(() => expect(screen.container.querySelector(".pele-edge")).not.toBeNull(), {
      timeout: 15_000,
    });
    const edges = () => [
      ...screen.container.querySelectorAll<SVGPathElement>(".pele-edge > path:not(.pele-marker)"),
    ];
    // Dashed by the diagram itself, or by a link style on the edge's group.
    const groupDash = (path: SVGPathElement) => path.parentElement?.style.strokeDasharray ?? "";
    const dotted = () =>
      edges().filter((path) => path.hasAttribute("stroke-dasharray") || groupDash(path) !== "");
    const thick = () => edges().filter((path) => path.hasAttribute("stroke-width"));
    const solid = () =>
      edges().filter(
        (path) =>
          !path.hasAttribute("stroke-dasharray") &&
          groupDash(path) === "" &&
          !path.hasAttribute("stroke-width"),
      );
    // The first edge carries its dash on the group (a link style), not on its path.
    expect(groupDash(edges()[0]!), `reduced ${reduced}`).not.toBe("");
    expect(dotted().length).toBeGreaterThan(0);
    expect(thick().length).toBeGreaterThan(0);
    expect(solid().length).toBeGreaterThan(0);
    const check = (phase: string) => {
      for (const path of dotted()) {
        const own = path.getAttribute("stroke-dasharray") ?? groupDash(path);
        // The pattern is the one the diagram drew, whether or not the edge is being drawn on.
        expect(path.hasAttribute("pathLength"), `${phase} dotted pathLength`).toBe(false);
        expect(getComputedStyle(path).strokeDasharray, `${phase} dotted dash`).toBe(
          own.replace(/px/g, "").split(/[ ,]+/).join("px, ") + "px",
        );
      }
      for (const path of thick()) {
        expect(getComputedStyle(path).strokeWidth, `${phase} thick`).toBe(
          `${path.getAttribute("stroke-width")}px`,
        );
      }
      for (const path of solid()) {
        expect(getComputedStyle(path).strokeWidth, `${phase} solid`).toBe("1.5px");
      }
    };
    check("at first");
    if (!reduced) {
      // The solid edges are drawn on, the dotted ones fade in.
      expect(getComputedStyle(solid()[0]!).animationName).toBe("one-chat-edge-draw");
      expect(getComputedStyle(dotted()[0]!).animationName).toBe("one-chat-diagram-in");
      const host = screen.container.querySelector(".chat-markdown-mermaid")!;
      await vi.waitFor(() => expect(host.hasAttribute("data-draw")).toBe(false), {
        timeout: 8_000,
      });
      check("after the draw-on");
    } else {
      expect(getComputedStyle(solid()[0]!).animationName).toBe("none");
      expect(getComputedStyle(dotted()[0]!).animationName).toBe("none");
    }
  }
});

const WIDE_DIAGRAM =
  "```mermaid\nflowchart LR\n  A[Lamp] --> B[Fresnel lens] --> C{Rings aligned?}\n  C -->|yes| D[Narrow beam] --> E[Distant horizon] --> F[Ship's bridge] --> G[Navigator] --> H[Chart table]\n  C -->|no| I[Scattered light]\n```";

it.each([1440, 900, 390] as const)(
  "Chat mode fits a wide diagram to the column at %ipx wide: nothing clipped or scrolling sideways, labels at 14px or more, and an Open larger action",
  async (width) => {
    using _mode = inMode("chat");
    using _motion = motion(true);
    await using _viewport = await wideViewport(width);
    const container = document.createElement("div");
    container.style.cssText = `height: 700px; width: ${Math.min(width, 1184)}px; display: flex; flex-direction: column;`;
    await using screen = await render(
      <MessagesTimeline
        {...baseProps()}
        timelineEntries={[
          message("ask-w", "user", "Draw it"),
          message("answer-w", "assistant", WIDE_DIAGRAM),
        ]}
      />,
      { container },
    );
    await vi.waitFor(() => expect(screen.container.querySelector(".pele-node")).not.toBeNull(), {
      timeout: 15_000,
    });
    const host = screen.container.querySelector<HTMLElement>(".chat-markdown-mermaid")!;
    const hostBox = host.getBoundingClientRect();
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
    for (const shape of host.querySelectorAll(".pele-node rect, .pele-node polygon")) {
      const box = shape.getBoundingClientRect();
      expect(box.left, "a node's left edge").toBeGreaterThanOrEqual(hostBox.left - 0.5);
      expect(box.right, "a node's right edge").toBeLessThanOrEqual(hostBox.right + 0.5);
    }
    const svg = host.querySelector("svg")!;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    for (const text of host.querySelectorAll<SVGTextElement>(
      ".pele-label, .pele-edge-label text",
    )) {
      expect(
        Number.parseFloat(getComputedStyle(text).fontSize) * scale,
        text.textContent ?? "",
      ).toBeGreaterThanOrEqual(13.5);
    }
    // Reachable from the keyboard, and it opens the larger view.
    const open = screen.getByRole("button", { name: "Open larger" });
    await expect.element(open).toBeVisible();
    (open.element() as HTMLElement).focus();
    expect(document.activeElement).toBe(open.element());
  },
);

it("Chat mode sets a paragraph that is all bold as a statement, keeps inline code light, and puts a code block's language at its top left", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  await using _viewport = await wideViewport(1440);
  const text = [
    "A sentence with **one bold phrase** and `inline`.",
    "**The whole of this closing summary is bold.**",
    "```ts\nconst a = 1;\n```",
  ].join("\n\n");
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: [message("ask-t", "user", "Tell me"), message("answer-t", "assistant", text)],
  });
  await vi.waitFor(() =>
    expect(screen.container.querySelector("p[data-one-statement]")).not.toBeNull(),
  );
  const statement = screen.container.querySelector<HTMLElement>("p[data-one-statement] > strong")!;
  expect(getComputedStyle(statement).fontWeight).toBe("500");
  const mixed = screen.container.querySelector<HTMLElement>(
    "p:not([data-one-statement]) > strong",
  )!;
  expect(Number(getComputedStyle(mixed).fontWeight)).toBeGreaterThan(500);
  const code = screen.container.querySelector<HTMLElement>(".chat-markdown :not(pre) > code")!;
  expect(getComputedStyle(code).fontSize).toBe(
    `${Number.parseFloat(getComputedStyle(code.parentElement!).fontSize) * 0.86}px`,
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-one-code-lang]")).not.toBeNull(),
  );
  const language = screen.container.querySelector<HTMLElement>("[data-one-code-lang]")!;
  const block = language.closest(".chat-markdown-codeblock")!.querySelector("pre")!;
  expect(language.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    block.getBoundingClientRect().top + 1,
  );
  expect(language.getBoundingClientRect().left).toBeLessThan(
    block.getBoundingClientRect().left + 40,
  );
});

const QUIZ_BLOCK = (explanations = true) =>
  "```quiz\n" +
  JSON.stringify({
    questions: [
      {
        question: "Why are the lens's rings thin?",
        options: ["Looks", "Weight", "Cost"],
        correct: 1,
        ...(explanations ? { explanation: "Less glass to carry." } : {}),
      },
      {
        question: "What must each ring match?",
        options: ["Its slope", "Its colour", "Its height"],
        correct: 0,
        explanation: "The slope aims the light.",
      },
    ],
  }) +
  "\n```";

/** Whatever a quiz test kept in this browser is gone when the test ends. */
function quizStorageCleared(): Disposable {
  const clear = () => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("one:quiz:")) window.localStorage.removeItem(key);
    }
  };
  clear();
  return { [Symbol.dispose]: clear };
}

function quizEntries(text: string, streaming = false): Entry[] {
  const answer = message("answer-quiz", "assistant", text);
  return [
    message("ask-quiz", "user", "Quiz me on this"),
    answer.kind === "message" ? { ...answer, message: { ...answer.message, streaming } } : answer,
  ];
}

it("Chat mode turns a quiz block into cards you answer with the keys 1 to 4 and Enter, and ends on a serif score", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  using _storage = quizStorageCleared();
  await using _viewport = await wideViewport(1440);
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: quizEntries(QUIZ_BLOCK()),
  });
  await expect.element(screen.getByText("Why are the lens's rings thin?")).toBeVisible();
  expect(screen.container.textContent).not.toContain('"questions"');
  // Every row is a real control: Tab reaches the options, and each is a radio.
  expect(screen.getByRole("radio").elements()).toHaveLength(3);

  const first = screen.getByRole("radio").first().element() as HTMLElement;
  first.focus();
  await userEvent.keyboard("1");
  // A wrong pick dims, the right row ticks in gold, the explanation reveals, and Next has focus.
  await expect.element(screen.getByText("Less glass to carry.")).toBeVisible();
  const options = [...screen.container.querySelectorAll<HTMLElement>(".one-chat-quiz-option")];
  expect(options.map((option) => option.dataset.state)).toEqual(["wrong", "correct", "dim"]);
  expect(options[1]!.querySelector(".one-chat-quiz-tick")).not.toBeNull();
  // A wrong pick is marked by more than colour: a cross, and words for a screen reader.
  expect(options[0]!.querySelector(".one-chat-quiz-cross")).not.toBeNull();
  expect(options[0]!.textContent).toContain("Your answer, not correct");
  expect(options[1]!.textContent).toContain("Correct answer");
  // Next is the card's one clear action, as tall as an extra large button (layout height: the
  // explanation is still turning down, which squeezes its drawn height).
  expect(
    (
      [...screen.container.querySelectorAll("button")].find(
        (button) => button.textContent === "Next",
      ) as HTMLElement
    ).offsetHeight,
  ).toBeGreaterThanOrEqual(40);
  expect(screen.container.querySelector('[role="status"].sr-only')?.textContent).toBe(
    "Not quite. The answer is Weight.",
  );
  // The pick is locked: another key changes nothing.
  await userEvent.keyboard("2");
  expect(options.map((option) => option.dataset.state)).toEqual(["wrong", "correct", "dim"]);
  expect(document.activeElement?.textContent).toBe("Next");

  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("What must each ring match?")).toBeVisible();
  // The next card has taken focus itself, so the keys go on without a click or a Tab.
  expect(document.activeElement?.getAttribute("role")).toBe("radio");
  await userEvent.keyboard("1");
  await expect.element(screen.getByText("The slope aims the light.")).toBeVisible();
  expect(document.activeElement?.textContent).toBe("See how you did");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("You got 1 of 2.")).toBeVisible();
  const score = screen.container.querySelector<HTMLElement>(".one-chat-quiz-score")!;
  expect(getComputedStyle(score).fontFamily).toContain("Iowan Old Style");
  await expect
    .element(screen.getByRole("button", { name: "Go over the one you missed" }))
    .toBeVisible();
});

it("Chat mode makes the quiz a reward: a wrong pick shakes and goes quiet, the right one lifts under a travelling light, and the score is a gold ring drawn on in 600ms", async () => {
  using _mode = inMode("chat");
  await using _viewport = await wideViewport(1440);
  onTestFinished(async () => {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  });
  const style = (element: Element, pseudo?: string) => getComputedStyle(element, pseudo);
  for (const reduced of [false, true]) {
    using _storage = quizStorageCleared();
    // The stylesheet's own media query, which the matchMedia stand-in does not reach.
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
    });
    await using screen = await renderTimeline({
      ...baseProps(),
      timelineEntries: quizEntries(QUIZ_BLOCK()),
    });
    await expect.element(screen.getByText("Why are the lens's rings thin?")).toBeVisible();
    (screen.getByRole("radio").first().element() as HTMLElement).focus();
    await userEvent.keyboard("1");
    await expect.element(screen.getByText("Less glass to carry.")).toBeVisible();
    const [wrong, right] = [
      ...screen.container.querySelectorAll<HTMLElement>(".one-chat-quiz-option"),
    ];
    expect(style(wrong!).animationName, `reduced ${reduced}`).toBe(
      reduced ? "none" : "one-chat-quiz-wrong",
    );
    expect(style(right!).animationName).toBe(reduced ? "none" : "one-chat-quiz-rise");
    expect(style(right!, "::after").animationName).toBe(reduced ? "none" : "one-chat-quiz-travel");
    // A wrong pick is still marked without colour: a line through it and a cross.
    expect(style(wrong!).textDecorationLine).toBe("line-through");
    // The options are lines of the column's own serif, not grey form rows.
    expect(style(right!).fontFamily).toContain("Iowan Old Style");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("1");
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("You got 1 of 2.")).toBeVisible();
    const number = screen.container.querySelector<HTMLElement>(".one-chat-quiz-ring-number")!;
    expect(number.textContent).toBe("1");
    expect(style(number).fontSize).toBe("48px");
    expect(style(number).fontFamily).toContain("Iowan Old Style");
    const ring = screen.container.querySelector<SVGCircleElement>(".one-chat-quiz-ring")!;
    expect(style(ring).strokeWidth).toBe("2px");
    // Half the questions right: half the circle, drawn on over 600ms.
    const circumference = 2 * Math.PI * Number(ring.getAttribute("r"));
    expect(Number.parseFloat(style(ring).strokeDasharray)).toBeCloseTo(circumference / 2, 1);
    expect(style(ring).animationDuration).toBe(reduced ? "0s" : "0.6s");
    // Another round is the card's one filled action.
    await expect
      .element(screen.getByRole("button", { name: "Go over the one you missed" }))
      .toBeVisible();
  }
});

it("Chat mode shows a quiz request as the person's short line in the bubble and the outline, whatever the app attached to it", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  using _storage = quizStorageCleared();
  await using _viewport = await wideViewport(1440);
  const ask = message("ask-round", "user", "Another round of three questions.");
  const sent: Entry =
    ask.kind === "message"
      ? {
          ...ask,
          message: {
            ...ask.message,
            context: { version: 1, records: [], agentContext: QUIZ_INSTRUCTIONS },
          },
        }
      : ask;
  await using screen = await renderTimeline({
    ...baseProps(),
    timelineEntries: [sent, message("answer-round", "assistant", QUIZ_BLOCK())],
  });
  await expect.element(screen.getByText("Another round of three questions.").first()).toBeVisible();
  for (const hidden of ["fenced code block", "JSON", '"questions":', "Ask three questions"]) {
    expect(screen.container.textContent, hidden).not.toContain(hidden);
  }
  const outline = screen.getByRole("navigation", { name: "In this chat" });
  expect(outline.element().textContent).toContain("Another round of three questions.");
  expect(outline.element().textContent).not.toContain("fenced code block");
});

it("a message made by an earlier build with its exact instructions inside its text still reads as a short line, and tags a person typed read as typed", async () => {
  using _storage = quizStorageCleared();
  const legacy =
    'Quiz me on what you just explained. Ask three questions. Reply with only a fenced code block labelled quiz that holds JSON in this shape: {"questions":[{"question":"...","options":["...","...","..."],"correct":0,"explanation":"..."}]}. Give three options for each question, the index of the right one as correct, and a sentence of explanation.';
  const shipped =
    'The person asked for a quiz. Ask three questions. Reply with only a fenced code block labelled quiz that holds JSON in this shape: {"questions":[{"question":"...","options":["...","...","..."],"correct":0,"explanation":"..."}]}. Give three options for each question, the index of the right one as correct, and a sentence of explanation.';
  const tagged = `Another round of three questions.\n\n<one-instructions>\n${shipped}\n</one-instructions>`;
  const typed =
    "Another round of three questions.\n\n<one-instructions>\nReply with only JSON.\n</one-instructions>";
  for (const [mode, text, shown, hidden] of [
    ["chat", legacy, "Quiz me on what you just explained.", "JSON"],
    ["code", legacy, "Quiz me on what you just explained.", "JSON"],
    ["code", tagged, "Another round of three questions.", "one-instructions"],
  ] as const) {
    using _mode = inMode(mode);
    await using screen = await renderTimeline({
      ...baseProps(),
      timelineEntries: [message("ask-old", "user", text), message("a", "assistant", "Sure.")],
    });
    await expect.element(screen.getByText(shown).first()).toBeVisible();
    expect(screen.container.textContent, `${mode}: ${hidden}`).not.toContain(hidden);
  }
  // Tags a person typed, with their own content between them, are shown exactly as typed.
  using _code = inMode("code");
  await using shown = await renderTimeline({
    ...baseProps(),
    timelineEntries: [message("ask-typed", "user", typed)],
  });
  await expect.element(shown.getByText(/one-instructions/).first()).toBeVisible();
});

it("Chat mode keeps two quizzes in one message apart: their own picks, their own saved state, and element ids that point at their own question", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  using _storage = quizStorageCleared();
  await using _viewport = await wideViewport(1440);
  const props = {
    ...baseProps(),
    timelineEntries: quizEntries(`${QUIZ_BLOCK()}\n\nAnd the same again.\n\n${QUIZ_BLOCK()}`),
  };
  const quizzes = (screen: { container: HTMLElement }) => [
    ...screen.container.querySelectorAll<HTMLElement>("[data-chat-quiz]"),
  ];
  {
    await using screen = await renderTimeline(props);
    await vi.waitFor(() => expect(quizzes(screen)).toHaveLength(2));
    const [first, second] = quizzes(screen);
    // Each question labels its own group of options.
    const labelled = (quiz: HTMLElement) =>
      quiz.querySelector('[role="radiogroup"]')!.getAttribute("aria-labelledby")!;
    expect(labelled(first!)).not.toBe(labelled(second!));
    for (const quiz of [first!, second!]) {
      expect(quiz.querySelector(`#${CSS.escape(labelled(quiz))}`)).toBe(
        quiz.querySelector(".one-chat-quiz-question"),
      );
    }
    // Answering the first leaves the second untouched.
    (first!.querySelector('[role="radio"]') as HTMLElement).click();
    await vi.waitFor(() => expect(first!.querySelector('[data-state="wrong"]')).not.toBeNull());
    expect(second!.querySelector('[data-state="wrong"]')).toBeNull();
    expect(second!.querySelector('[data-state="correct"]')).toBeNull();
  }
  {
    // Reopened, the first quiz is where it was left and the second is still on its first question.
    await using reopened = await renderTimeline(props);
    await vi.waitFor(() => expect(quizzes(reopened)).toHaveLength(2));
    const [first, second] = quizzes(reopened);
    expect(first!.textContent).toContain("Question 2 of 2");
    expect(second!.textContent).toContain("Question 1 of 2");
    expect(second!.querySelector('[data-state="wrong"]')).toBeNull();
  }
});

it("Chat mode keeps two quizzes apart while their message is still streaming, and keeps the picks when the stream ends", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  using _storage = quizStorageCleared();
  await using _viewport = await wideViewport(1440);
  const text = `${QUIZ_BLOCK()}\n\nAnd again.\n\n${QUIZ_BLOCK()}`;
  const props = { ...baseProps(), timelineEntries: quizEntries(text, true) };
  await using screen = await renderTimeline(props);
  const quizzes = () => [...screen.container.querySelectorAll<HTMLElement>("[data-chat-quiz]")];
  await vi.waitFor(() => expect(quizzes()).toHaveLength(2));
  // Answer the second quiz while the answer is still being written.
  (quizzes()[1]!.querySelector('[role="radio"]') as HTMLElement).click();
  await vi.waitFor(() =>
    expect(quizzes()[1]!.querySelector('[data-state="wrong"]')).not.toBeNull(),
  );
  expect(quizzes()[0]!.querySelector('[data-state="wrong"], [data-state="correct"]')).toBeNull();
  // The stream ends: the same quiz still holds its pick, and the first is still open.
  await screen.rerender(<MessagesTimeline {...props} timelineEntries={quizEntries(text, false)} />);
  await vi.waitFor(() => expect(quizzes()).toHaveLength(2));
  // Reopened where it was left: the second quiz is on its next question, the first untouched.
  await vi.waitFor(() => expect(quizzes()[1]!.textContent).toContain("Question 2 of 2"));
  expect(quizzes()[0]!.textContent).toContain("Question 1 of 2");
});

it("Chat mode keeps a quiz's picks with its message, so reopening shows it finished, and lets the person go over what they missed", async () => {
  using _mode = inMode("chat");
  using _motion = motion(true);
  using _storage = quizStorageCleared();
  await using _viewport = await wideViewport(1440);
  const props = { ...baseProps(), timelineEntries: quizEntries(QUIZ_BLOCK()) };
  {
    await using screen = await renderTimeline(props);
    await expect.element(screen.getByText("Why are the lens's rings thin?")).toBeVisible();
    await screen.getByRole("radio").first().click();
    await screen.getByRole("button", { name: "Next" }).click();
    await screen.getByRole("radio").first().click();
    await screen.getByRole("button", { name: "See how you did" }).click();
    await expect.element(screen.getByText("You got 1 of 2.")).toBeVisible();
  }
  {
    await using reopened = await renderTimeline({
      ...props,
      routeThreadKey: "environment-local:reopened",
    });
    await expect.element(reopened.getByText("You got 1 of 2.")).toBeVisible();
    await reopened.getByRole("button", { name: "Go over the one you missed" }).click();
    // Back to the missed question with a fresh row, the other pick kept.
    await expect.element(reopened.getByText("Why are the lens's rings thin?")).toBeVisible();
    expect(
      reopened.container.querySelectorAll('.one-chat-quiz-option[data-state="open"]'),
    ).toHaveLength(3);
    await reopened.getByRole("radio", { name: "Weight" }).click();
    await reopened.getByRole("button", { name: "See how you did" }).click();
    await expect.element(reopened.getByText("You got 2 of 2.")).toBeVisible();
  }
});

it.each([1440, 390] as const)(
  "Chat mode keeps the question where it is when a quiz reveals its explanation, at %ipx wide",
  async (width) => {
    using _mode = inMode("chat");
    using _motion = motion(true);
    using _storage = quizStorageCleared();
    await using _viewport = await wideViewport(width);
    const container = document.createElement("div");
    container.style.cssText = `height: 700px; width: ${Math.min(width, 1184)}px; display: flex; flex-direction: column;`;
    const entries = [...turns(2), ...quizEntries(QUIZ_BLOCK())];
    await using screen = await render(
      followUpScene(composerStandIn(""), { ...baseProps(), timelineEntries: entries }),
      { container },
    );
    const questionTop = () =>
      screen.container
        .querySelector<HTMLElement>(".one-chat-quiz-question")
        ?.getBoundingClientRect().top;
    await vi.waitFor(() => {
      const scroller = screen.container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
      expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(2);
      expect(questionTop()).toBeDefined();
    });
    const before = questionTop()!;
    using _timers = fakeTimers();
    await screen.getByRole("radio").first().click();
    await vi.waitFor(
      () => expect(screen.container.querySelector(".one-chat-quiz-explain")).not.toBeNull(),
      {
        interval: 1,
      },
    );
    await act(() => vi.advanceTimersByTime(900));
    expect(Math.abs(questionTop()! - before)).toBeLessThan(1);
  },
);

it("Chat mode never shows a quiz block's JSON: the working arc and one line hold its place while it streams, one sentence stands in if it cannot be read, and Code mode shows the text", async () => {
  using _storage = quizStorageCleared();
  const streaming = quizEntries(QUIZ_BLOCK().slice(0, 120), true);
  const broken = quizEntries('```quiz\n{"questions":[{"question":"No options"}]}\n```');
  {
    using _mode = inMode("chat");
    {
      await using screen = await renderTimeline({ ...baseProps(), timelineEntries: streaming });
      await vi.waitFor(() =>
        expect(screen.container.querySelector(".one-chat-quiz-pending")).not.toBeNull(),
      );
      expect(screen.container.textContent).not.toContain('"questions"');
      expect(screen.container.querySelector(".one-chat-quiz-pending")!.textContent).toBe(
        "Writing your questions",
      );
      expect(
        screen.container.querySelector(".one-chat-quiz-pending [data-working-arc]"),
      ).not.toBeNull();
    }
    {
      await using screen = await renderTimeline({ ...baseProps(), timelineEntries: broken });
      await expect.element(screen.getByText(/The quiz did not come out right/)).toBeVisible();
      expect(screen.container.textContent).not.toContain("No options");
      expect(screen.container.querySelector("[data-chat-quiz]")).toBeNull();
    }
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({
      ...baseProps(),
      timelineEntries: quizEntries(QUIZ_BLOCK()),
    });
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain("Why are the lens's rings thin?"),
    );
    expect(screen.container.querySelector("[data-chat-quiz]")).toBeNull();
  }
});

/** An answer, then what the run raised after it: a notice and/or a failed turn. */
function noticeFixture(options: {
  notices?: number;
  failure?: boolean;
  signIn?: boolean;
  /** Further servers that need a sign-in, each as its own notice. */
  signInServers?: ReadonlyArray<string>;
  /** The turn called a tool of this MCP server. */
  calledTool?: string;
  /** The app sent the question with notes the person cannot see. */
  appNotes?: boolean;
  errorNotice?: boolean;
}) {
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
  // Shaped like the Codex adapter's failed-start notice: no level, a sign-in, the CLI's own words.
  const signInNotice = {
    ...work,
    position: work.position + 20,
    sourceItemId: TurnItemId.make("notice-sign-in"),
    item: {
      ...work.item,
      id: TurnItemId.make("notice-sign-in"),
      type: "system_notice" as const,
      status: "completed" as const,
      providerThreadId: ProviderThreadId.make("codex-thread-1"),
      title: "MCP server mem0 failed to start",
      message: "mem0 requires reauthentication. Run `codex mcp login mem0` to sign in.",
      mcpSignIn: { server: "mem0" },
    },
  } as unknown as typeof work;
  const extraSignIn = (server: string, index: number) =>
    ({
      ...signInNotice,
      position: work.position + 40 + index,
      sourceItemId: TurnItemId.make(`notice-sign-in-${index}`),
      item: {
        ...signInNotice.item,
        id: TurnItemId.make(`notice-sign-in-${index}`),
        title: `MCP server ${server} needs a sign-in`,
        message: `The ${server} MCP server needs a sign-in before Claude can use it.`,
        mcpSignIn: { server },
      },
    }) as unknown as typeof work;
  const toolCall = options.calledTool
    ? ({
        ...work,
        position: work.position + 5,
        sourceItemId: TurnItemId.make("tool-call"),
        item: {
          ...work.item,
          id: TurnItemId.make("tool-call"),
          toolName: `mcp__${options.calledTool}__search`,
          status: "completed" as const,
        },
      } as unknown as typeof work)
    : null;
  const errorNotice = {
    ...signInNotice,
    position: work.position + 25,
    sourceItemId: TurnItemId.make("notice-error"),
    item: {
      ...signInNotice.item,
      id: TurnItemId.make("notice-error"),
      title: "Workspace sync failed",
      message: "EACCES: permission denied, open '/srv/app/.sync-lock'",
      level: "error" as const,
      mcpSignIn: undefined,
    },
  } as unknown as typeof work;
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
  const question = options.appNotes
    ? ({
        ...user,
        item: {
          ...user.item,
          context: { version: 1, records: [], agentContext: "Explain the Providers page." },
        },
      } as typeof user)
    : user;
  return deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: [
      question,
      answer,
      ...Array.from({ length: options.notices ?? 0 }, (_, index) => notice(index)),
      ...(toolCall ? [toolCall] : []),
      ...(options.signIn ? [signInNotice] : []),
      ...(options.signInServers ?? []).map(extraSignIn),
      ...(options.errorNotice ? [errorNotice] : []),
      ...(options.failure ? [failure] : []),
    ],
    optimisticMessages: [],
  });
}

it("Chat mode keeps a turn's quiet notices out of the conversation, behind the header's status dot, and Code mode keeps each row", async () => {
  const timelineEntries = noticeFixture({ notices: 2 });
  {
    using _mode = inMode("chat");
    await using screen = await renderTimelineWithStatus({ ...baseProps(), timelineEntries });
    const dot = screen.getByRole("button", { name: /2 notes/ });
    await expect.element(dot).toBeVisible();
    expect(screen.container.querySelector("[data-chat-notice]")).toBeNull();
    expect(screen.container.textContent).not.toContain("timed out after 30 seconds");

    await dot.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".one-chat-status-title")).toHaveLength(2),
    );
    const texts = [...document.querySelectorAll<HTMLElement>(".one-chat-status-title")];
    for (const text of texts) {
      // Wrapped, never cut off: the whole sentence is there and nothing overflows its box.
      expect(text.textContent).toContain("to give it longer to start.");
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
    }
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

it("Chat mode keeps an error and a sign-in for a tool the turn called in view in plain words, and leaves the rest to the status dot", async () => {
  const timelineEntries = noticeFixture({
    notices: 1,
    signIn: true,
    errorNotice: true,
    calledTool: "mem0",
  });
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await expect
      .element(screen.getByText("mem0 could not start because it needs you to sign in."))
      .toBeVisible();
    await expect.element(screen.getByText("Something needs your attention.")).toBeVisible();
    // The timed-out warning needs nothing from the person, so it is not in the conversation.
    expect(screen.container.textContent).not.toContain("timed out after 30 seconds");
    // The CLI's words wait behind the disclosure instead of leading.
    expect(screen.container.textContent).not.toContain("codex mcp login mem0");
    expect(screen.container.textContent).not.toContain("EACCES");
    await screen.getByRole("button", { name: "Technical details" }).first().click();
    expect(screen.container.textContent).toContain("codex mcp login mem0");
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await expect.element(screen.getByText(/codex mcp login mem0/)).toBeVisible();
    expect(screen.container.querySelector("[data-chat-failure]")).toBeNull();
  }
});

const SIGN_IN_SERVERS = [
  "plugin:exa:exa",
  "plugin:productivity:notion",
  "plugin:productivity:gmail",
  "plugin:engineering:gmail",
];

it("Chat mode folds sign-ins for tools the turn never called into one quiet line with a sign-in per tool, and never as an alert", async () => {
  const timelineEntries = noticeFixture({ signInServers: SIGN_IN_SERVERS });
  {
    using _mode = inMode("chat");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    const line = screen.getByRole("button", { name: "4 tools need sign-in" });
    await expect.element(line).toBeVisible();
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
    expect(screen.container.textContent).not.toContain("could not start because");
    expect(screen.container.querySelectorAll("[data-chat-sign-in-line]")).toHaveLength(1);

    await line.click();
    const names = [...screen.container.querySelectorAll(".one-chat-signin-row > span")].map(
      (node) => node.textContent,
    );
    // A name two plugins share says which plugin it belongs to.
    expect(names).toEqual(["Exa", "Notion", "Gmail (productivity)", "Gmail (engineering)"]);
  }
  {
    using _mode = inMode("code");
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await vi.waitFor(() =>
      expect(screen.container.querySelectorAll('[data-v2-item-type="system_notice"]')).toHaveLength(
        4,
      ),
    );
    expect(screen.container.querySelector("[data-chat-sign-in-line]")).toBeNull();
  }
});

it("Chat mode shows a sign-in the turn needed as a sentence, and folds only the tools it did not call", async () => {
  const timelineEntries = noticeFixture({
    signInServers: ["plugin_exa_exa", "linear"],
    calledTool: "plugin_exa_exa",
  });
  using _mode = inMode("chat");
  await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
  await expect
    .element(screen.getByText("plugin_exa_exa could not start because it needs you to sign in."))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "1 tool needs sign-in" })).toBeVisible();
  expect(screen.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
});

it("a thread the app started with hidden notes shows no sign-in line for tools its question never called, and still shows one it needed", async () => {
  using _mode = inMode("chat");
  {
    const timelineEntries = noticeFixture({ signInServers: SIGN_IN_SERVERS, appNotes: true });
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await expect.element(screen.getByText("The file is short.")).toBeVisible();
    expect(screen.container.querySelector("[data-chat-sign-in-line]")).toBeNull();
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  }
  {
    const timelineEntries = noticeFixture({
      signInServers: ["plugin_exa_exa", "linear"],
      calledTool: "plugin_exa_exa",
      appNotes: true,
    });
    await using screen = await renderTimeline({ ...baseProps(), timelineEntries });
    await expect
      .element(screen.getByText("plugin_exa_exa could not start because it needs you to sign in."))
      .toBeVisible();
    expect(screen.container.querySelector("[data-chat-sign-in-line]")).toBeNull();
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
      `Here it is.\n\n![A third order lens, seen from the side](${window.location.origin}/favicon-32x32.png)\n\nIn a sentence ![inline](${window.location.origin}/favicon-16x16.png) it has none.`,
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
  expect(arrived.map((p) => getComputedStyle(p).animationDelay)).toEqual([
    "0.1s",
    "0.18s",
    "0.26s",
  ]);
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

it("Chat mode never replays the reveal on an answer that streamed in when its stream ends", async () => {
  using _mode = inMode("chat");
  using _motion = motion(false);
  const props = baseProps();
  const opening = [
    message("ask-1", "user", "First question"),
    message("answer-1", "assistant", "Hi"),
  ];
  await using screen = await renderTimeline({ ...props, timelineEntries: opening });
  const question = message("ask-2", "user", "Next question");
  const streamed = (text: string, streaming: boolean): Entry => {
    const answer = message("answer-2", "assistant", text);
    return answer.kind === "message"
      ? { ...answer, message: { ...answer.message, streaming } }
      : answer;
  };
  const body = "Alpha.\n\nBeta.\n\nGamma.";
  await screen.rerender(
    <MessagesTimeline {...props} timelineEntries={[...opening, question, streamed(body, true)]} />,
  );
  const answer = () => screen.container.querySelector<HTMLElement>('[data-message-id="answer-2"]')!;
  await vi.waitFor(() => expect(answer().querySelector("[data-streaming]")).not.toBeNull());
  expect(arrivals(screen.container)).toEqual([]);

  await screen.rerender(
    <MessagesTimeline {...props} timelineEntries={[...opening, question, streamed(body, false)]} />,
  );
  await vi.waitFor(() => expect(answer().querySelector("[data-streaming]")).toBeNull());
  const paragraphs = [...answer().querySelectorAll<HTMLElement>(".chat-markdown > p")];
  expect(paragraphs).toHaveLength(3);
  expect(arrivals(screen.container)).toEqual([]);
  expect(paragraphs.map((p) => getComputedStyle(p).animationName)).toEqual([
    "none",
    "none",
    "none",
  ]);
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
