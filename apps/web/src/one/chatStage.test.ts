import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { findChatStageTarget, findHandoffAnswerId } from "./chatStage";

function row(id: string, role: "user" | "assistant", text: string): MessagesTimelineRow {
  return { kind: "message", id, message: { id, role, text } } as unknown as MessagesTimelineRow;
}

describe("the waiting stage and the answer that takes over from it", () => {
  const ask = row("ask", "user", "Why?");

  it("stays for an answer that has no words yet, and hands over to the first one that has", () => {
    const empty = row("empty", "assistant", "  ");
    const real = row("real", "assistant", "Because.");
    expect(findChatStageTarget([ask, empty], { turnRunning: true, awaitingPerson: false })).toEqual(
      expect.objectContaining({ userRowId: "ask" }),
    );
    expect(
      findChatStageTarget([ask, empty, real], { turnRunning: true, awaitingPerson: false }),
    ).toBeNull();
    // The row that fades in is the one with words, not the empty one before it.
    expect(findHandoffAnswerId([ask, empty, real], "ask")).toBe("real");
    expect(findHandoffAnswerId([ask, empty], "ask")).toBeNull();
  });

  it("finds no answer for a question that is not in the rows", () => {
    expect(findHandoffAnswerId([ask, row("a", "assistant", "Yes.")], "other")).toBeNull();
  });
});
