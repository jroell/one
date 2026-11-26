import { EnvironmentId, MessageId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { MessagesTimeline } from "./MessagesTimeline";
import { ActivityShimmerOverlay } from "./TimelineRowParts";

vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: null,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: false,
    refresh: () => {},
  })) as never,
}));

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const CREATED_AT = "2026-03-17T19:12:28.000Z";
const THREAD_LENGTH = 600;

function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  return {
    isWorking: true,
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
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
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

function assistantMessage(index: number, text: string, streaming = false): Entry {
  return {
    id: `entry-${index}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(`message-${index}`),
      role: "assistant",
      text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming,
    },
  };
}

/** A reply shaped like real agent output: a heading, prose, a list and a code block. */
function longReply(index: number, withCode = true): string {
  const parts = [
    `## Step ${index}`,
    `Marker-${index}-end ${"The parser reads each token and keeps the open blocks on a stack. ".repeat(8)}`,
    "- reads the file\n- updates the index\n- runs the tests",
    "```ts\n" +
      Array.from(
        { length: 6 },
        (_, line) => `const value${line} = compute(${index}, ${line});`,
      ).join("\n") +
      "\n```",
  ];
  return (withCode ? parts : parts.slice(0, 3)).join("\n\n");
}

const history = Array.from({ length: THREAD_LENGTH - 1 }, (_, index) =>
  assistantMessage(index, longReply(index)),
);

async function renderThread(entries: Entry[], props = baseProps()) {
  const container = document.createElement("div");
  container.style.cssText = "height: 1200px; width: 900px; display: flex; flex-direction: column;";
  const timeline = (next: Entry[]) => <MessagesTimeline {...props} timelineEntries={next} />;
  const screen = await render(timeline(entries), { container });
  return {
    container,
    distanceFromEnd: () => {
      const viewport = props.listRef.current?.getScrollableNode();
      if (!viewport) return Number.POSITIVE_INFINITY;
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    },
    rerender: (next: Entry[]) => screen.rerender(timeline(next)),
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

function mountedMarkers(container: HTMLElement): number {
  return (container.textContent?.match(/Marker-\d+-end/g) ?? []).length;
}

describe("MessagesTimeline with a 600-message thread", () => {
  it("opens at the newest message and mounts only the messages near the viewport", async () => {
    const last = THREAD_LENGTH - 1;
    await using thread = await renderThread([...history, assistantMessage(last, longReply(last))]);

    await vi.waitFor(() => expect(thread.container.textContent).toContain(`Marker-${last}-end`));
    // 600 long replies exist; a 1200px viewport shows a handful. Mounting them all is the
    // regression that makes long threads slow to open and to scroll.
    expect(mountedMarkers(thread.container)).toBeLessThan(60);
    await vi.waitFor(() => expect(thread.distanceFromEnd()).toBeLessThanOrEqual(1));
    expect(mountedMarkers(thread.container)).toBeLessThan(60);
  });

  it("changes only the streaming message while 40 chunks arrive, not the messages above it", async () => {
    const last = THREAD_LENGTH - 1;
    const streamed = (chunks: number) =>
      assistantMessage(last, `Tail-start ${"more words arrive here. ".repeat(chunks)}`, true);
    // The observed message has no code block: highlighting finishes later and swaps that block
    // once, which has nothing to do with streaming.
    const above = [...history.slice(0, -1), assistantMessage(last - 1, longReply(last - 1, false))];
    await using thread = await renderThread([...above, streamed(1)]);

    const previousRow = await vi.waitFor(() => {
      const paragraph = [...thread.container.querySelectorAll("p")].find((candidate) =>
        candidate.textContent?.includes(`Marker-${last - 1}-end`),
      );
      expect(paragraph).toBeDefined();
      return paragraph!.parentElement!;
    });
    // Observe only once the thread has settled at its end, so opening it is not counted.
    await vi.waitFor(() => expect(thread.distanceFromEnd()).toBeLessThanOrEqual(1));
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(previousRow, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    for (let chunks = 2; chunks <= 41; chunks++) {
      await thread.rerender([...above, streamed(chunks)]);
    }
    await vi.waitFor(() =>
      expect(thread.container.textContent).toContain("more words arrive here. ".repeat(41).trim()),
    );
    changes.push(...observer.takeRecords());
    observer.disconnect();

    expect(
      changes.map(
        (record) =>
          `${record.type} ${record.attributeName ?? ""} on ${(record.target as HTMLElement).tagName ?? "#text"}.${(record.target as HTMLElement).className ?? ""} +${record.addedNodes.length} -${record.removedNodes.length}`,
      ),
    ).toEqual([]);
    // The same element is still the mounted row: a replaced row would leave this one detached.
    expect(previousRow.isConnected).toBe(true);
    expect(previousRow.textContent).toContain(`Marker-${last - 1}-end`);
    expect(mountedMarkers(thread.container)).toBeLessThan(60);
  });

  it("forces few style passes, and leaves html and body out of every :has() re-check, when the thread is switched", async () => {
    const other = history.map((entry, index) => ({
      ...entry,
      id: `other-${index}`,
      message: {
        ...(entry as { message: object }).message,
        id: MessageId.make(`other-message-${index}`),
      },
    })) as Entry[];
    const props = baseProps();
    const container = document.createElement("div");
    container.style.cssText =
      "height: 1200px; width: 900px; display: flex; flex-direction: column;";
    // The new thread opens with a live row: its shimmer overlay mounts in the same commit, which is
    // what a `:has()` rule on the overlay re-evaluates for every ancestor, the root included.
    const timeline = (key: string, entries: Entry[], live = false) => (
      <>
        <MessagesTimeline {...props} routeThreadKey={key} timelineEntries={entries} />
        {live ? (
          <span className="one-shimmer-host relative inline-block overflow-hidden">
            Reading
            <ActivityShimmerOverlay>Reading</ActivityShimmerOverlay>
          </span>
        ) : null}
      </>
    );
    const keyA = `${props.routeThreadKey}-a`;
    const keyB = `${props.routeThreadKey}-b`;
    await using screen = await render(timeline(keyA, history), { container });
    const lastMarker = `Marker-${history.length - 1}-end`;
    await vi.waitFor(() => expect(container.textContent).toContain(lastMarker));
    const viewport = props.listRef.current!.getScrollableNode()!;
    await vi.waitFor(() =>
      expect(
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      ).toBeLessThanOrEqual(1),
    );

    // The rest of the app is on the page: a rule that dirties every element restyles all of it on
    // each forced pass, which a timeline alone would hide.
    const filler = document.createElement("div");
    filler.append(
      ...Array.from({ length: 1500 }, () => {
        const row = document.createElement("div");
        row.append(document.createElement("span"), document.createElement("span"));
        return row;
      }),
    );
    document.body.append(filler);
    using _filler = { [Symbol.dispose]: () => filler.remove() };
    const session = cdp();
    const events: Array<{
      name: string;
      ph: string;
      args?: {
        elementCount?: number;
        beginData?: { stackTrace?: unknown[] };
        data?: { reason?: string; nodeName?: string };
      };
    }> = [];
    const collect = (data: { value: typeof events }) => events.push(...data.value);
    session.on("Tracing.dataCollected", collect as never);
    let complete: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const onComplete = () => complete();
    session.on("Tracing.tracingComplete", onComplete as never);
    await session.send("Tracing.start", {
      categories:
        "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking",
      transferMode: "ReportEvents",
    });
    await screen.rerender(timeline(keyB, other, true));
    await vi.waitFor(() => expect(container.textContent).toContain(lastMarker));
    await session.send("Tracing.end");
    await finished;
    session.off("Tracing.dataCollected", collect as never);
    session.off("Tracing.tracingComplete", onComplete as never);

    const styled = events.filter((event) => event.ph === "X" && event.name === "UpdateLayoutTree");
    // A recalculation with a script stack is one a measurement forced mid-commit.
    const forced = styled.filter((event) => (event.args?.beginData?.stackTrace?.length ?? 0) > 0);
    // A `:has()` rule on html or on every element (the shimmer colour once was one) is re-checked
    // after every node a commit inserts or removes: the browser then lists the root as affected.
    const rootsAffectedByHas = events.filter(
      (event) =>
        event.name === "StyleRecalcInvalidationTracking" &&
        event.args?.data?.reason === "Affected by :has()" &&
        ["HTML", "BODY"].includes(event.args.data.nodeName ?? ""),
    );
    expect(rootsAffectedByHas.length).toBe(0);
    // Measured: 4 passes forced by script; each extra one is a style pass over the commit's changes.
    expect(forced.length).toBeLessThanOrEqual(10);
  });
});
