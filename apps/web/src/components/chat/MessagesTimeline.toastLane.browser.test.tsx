import { EnvironmentId, MessageId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { useToastLane } from "../ui/useComposerAnchor";
import { MessagesTimeline } from "./MessagesTimeline";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const CREATED_AT = "2026-03-17T19:12:28.000Z";
const LANE_PX = 120; // a 100px toast + 12px gap + 8px margin

function entry(index: number): Entry {
  return {
    id: `entry-${index}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(`message-${index}`),
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Line ${index}: ${"the build printed a long line. ".repeat(6)}`,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
    },
  };
}

function props(threadKey: string): TimelineProps {
  return {
    timelineEntries: Array.from({ length: 40 }, (_, index) => entry(index)),
    isWorking: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: threadKey,
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    markdownCwd: undefined,
    resolvedTheme: "light",
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

function Harness({ toast, threadKey }: { readonly toast: boolean; readonly threadKey: string }) {
  useToastLane(toast, 100);
  return <MessagesTimeline {...props(threadKey)} />;
}

/** A reader who asks for reduced motion gets instant scrolls, which the test can read at once. */
function reducedMotion(): Disposable {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const list = original.call(window, query);
    if (!query.includes("prefers-reduced-motion")) return list;
    return new Proxy(list, {
      get(target, key) {
        if (key === "matches") return true;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof window.matchMedia;
  return {
    [Symbol.dispose]() {
      window.matchMedia = original;
    },
  };
}

/** The lowest bottom edge among the text lines drawn in the scroller. */
function lastTextBottom(scroller: HTMLElement) {
  let bottom = 0;
  const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects())
      if (rect.width > 0) bottom = Math.max(bottom, rect.bottom);
  }
  return bottom;
}

describe("a toast over the real thread timeline", () => {
  it("keeps the last lines of a thread scrolled to its end at least the toast's lane above the bottom edge", async () => {
    using _motion = reducedMotion();
    const container = document.createElement("div");
    container.style.cssText = "height: 600px; width: 900px; display: flex; flex-direction: column;";
    const threadKey = `environment-local:thread-${Math.random().toString(36).slice(2)}`;
    await using screen = await render(<Harness toast={false} threadKey={threadKey} />, {
      container,
      router: false,
    });
    const scroller = container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
    await expect
      .poll(() => scroller.scrollHeight, { message: "the thread has content" })
      .toBeGreaterThan(scroller.clientHeight);
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight, {
        message: "the thread rests at its end",
      })
      .toBeLessThan(4);
    const edge = scroller.getBoundingClientRect().bottom;
    const gapBefore = edge - lastTextBottom(scroller);

    await screen.rerender(<Harness toast threadKey={threadKey} />);

    await expect
      .poll(() => edge - lastTextBottom(scroller), {
        message: `the last line sits ${LANE_PX}px or more above the edge, where the toast is`,
      })
      .toBeGreaterThanOrEqual(LANE_PX);
    expect(gapBefore, "without the lane the last line was closer than that").toBeLessThan(LANE_PX);
  });
});
