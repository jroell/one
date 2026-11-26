import { EnvironmentId, MessageId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { expect, it } from "vite-plus/test";

import "~/index.css";

import { act, render } from "../../../test/render";
import { dispatchVoiceSession } from "~/one/voiceSession";
import { MessagesTimeline } from "./MessagesTimeline";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const CREATED_AT = "2026-03-17T19:12:28.000Z";
const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function answer(text: string, id: string): Entry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role: "assistant",
      text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
    },
  };
}

function props(entries: ReadonlyArray<Entry>, threadKey: string): TimelineProps {
  return {
    timelineEntries: entries as Entry[],
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

it("the timeline under voice chat does not render what streams in while the stage is open, and catches up when it closes", async () => {
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 900px; display: flex; flex-direction: column;";
  const threadKey = `environment-local:thread-${Math.random().toString(36).slice(2)}`;
  const first = [answer("First answer.", "m1")];
  const streamed = [...first, answer("Streamed while voice chat was open.", "m2")];
  await using screen = await render(<MessagesTimeline {...props(first, threadKey)} />, {
    container,
    router: false,
  });
  using _voice = { [Symbol.dispose]: () => dispatchVoiceSession({ type: "stop" }) };
  expect(container.textContent).toContain("First answer.");

  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await screen.rerender(<MessagesTimeline {...props(streamed, threadKey)} />);
  expect(container.textContent).not.toContain("Streamed while voice chat was open.");

  await act(() => dispatchVoiceSession({ type: "stop" }));
  await screen.rerender(<MessagesTimeline {...props(streamed, threadKey)} />);
  expect(container.textContent).toContain("Streamed while voice chat was open.");
});
