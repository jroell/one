import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createSilenceDetector,
  hasPendingUserRequest,
  reduceVoiceSession,
  replyAnchor,
  selectReply,
  speakableText,
  VOICE_SESSION_OFF,
  type ReplyAnchor,
  type SpokenReply,
  type VoiceMessage,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "./voiceSession";

const NOTHING_BEFORE: ReplyAnchor = { afterId: null, count: 0 };
const ANSWER: SpokenReply = { id: "a2", text: "Light bends." };

function run(events: ReadonlyArray<VoiceSessionEvent>): VoiceSessionState {
  return events.reduce(reduceVoiceSession, VOICE_SESSION_OFF);
}

describe("voice chat turn order", () => {
  it("goes from listening to sending, thinking, speaking and back to listening", () => {
    const stages = [
      { type: "start", threadKey: "t1" } as const,
      { type: "sent", after: NOTHING_BEFORE } as const,
      { type: "working" } as const,
      { type: "replied", reply: ANSWER } as const,
      { type: "spoken" } as const,
    ].reduce<string[]>((seen, _event, index, events) => {
      seen.push(run(events.slice(0, index + 1)).stage);
      return seen;
    }, []);
    expect(stages).toEqual(["listening", "sending", "thinking", "speaking", "listening"]);
  });

  it("remembers where the conversation stood at send time so an old reply is never read aloud", () => {
    const after = { afterId: "a1", count: 4 };
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after },
    ]);
    expect(state.sentAfter).toEqual(after);
  });

  it("reads a finished answer that was seen without any frame showing the thread working", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "replied", reply: ANSWER },
    ]);
    expect(state).toMatchObject({ stage: "speaking", reply: ANSWER });
  });

  it("keeps the reply it began reading, whatever arrives while it is read", () => {
    const speaking = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "working" },
      { type: "replied", reply: ANSWER },
    ]);
    expect(
      reduceVoiceSession(speaking, { type: "replied", reply: { id: "a3", text: "Later." } }),
    ).toBe(speaking);
  });

  it("ignores the end of an earlier reading once another reply is being read", () => {
    const speaking = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "working" },
      { type: "replied", reply: ANSWER },
    ]);
    expect(reduceVoiceSession(speaking, { type: "spoken", replyId: "a1" })).toBe(speaking);
    expect(reduceVoiceSession(speaking, { type: "spoken", replyId: "a2" }).stage).toBe("listening");
  });

  it("holds an error from a failed send until the person tries again, then clears it", () => {
    const failed = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "failed", message: "Voice input took too long" },
    ]);
    expect(failed).toMatchObject({ stage: "listening", error: "Voice input took too long" });
    expect(reduceVoiceSession(failed, { type: "retried" }).error).toBeNull();
  });

  it("listens again when a turn ends with nothing new to read", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "working" },
      { type: "replied", reply: null },
    ]);
    expect(state.stage).toBe("listening");
  });

  it("listens again when the question could not be sent", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "failed" },
    ]);
    expect(state.stage).toBe("listening");
  });

  it("stops from every stage", () => {
    const turn: ReadonlyArray<VoiceSessionEvent> = [
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "working" },
      { type: "replied", reply: ANSWER },
    ];
    for (let length = 1; length <= turn.length; length++) {
      const active = run(turn.slice(0, length));
      expect(reduceVoiceSession(active, { type: "stop" })).toEqual(VOICE_SESSION_OFF);
    }
  });

  it("follows a draft to the saved thread it becomes once its question is sent", () => {
    const sent = run([
      { type: "start", threadKey: "draft-1", isDraft: true },
      { type: "sent", after: NOTHING_BEFORE },
    ]);
    const promoted = reduceVoiceSession(sent, { type: "promoted", threadKey: "thread-9" });
    expect(promoted).toMatchObject({ stage: "sending", threadKey: "thread-9" });
    // A second change of key is another thread, not a promotion.
    expect(reduceVoiceSession(promoted, { type: "promoted", threadKey: "thread-10" })).toBe(
      promoted,
    );
  });

  it("does not follow a saved thread, or a draft that has not sent anything, to another key", () => {
    const saved = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
    ]);
    expect(reduceVoiceSession(saved, { type: "promoted", threadKey: "t2" })).toBe(saved);
    const listeningDraft = run([{ type: "start", threadKey: "draft-1", isDraft: true }]);
    expect(reduceVoiceSession(listeningDraft, { type: "promoted", threadKey: "t2" })).toBe(
      listeningDraft,
    );
  });

  it("keeps the thread it started in through a whole turn", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "working" },
      { type: "replied", reply: ANSWER },
      { type: "spoken" },
    ]);
    expect(state).toMatchObject({ stage: "listening", threadKey: "t1" });
  });

  it("ignores events that do not belong to the current stage", () => {
    const listening = run([{ type: "start", threadKey: "t1" }]);
    expect(reduceVoiceSession(listening, { type: "working" })).toBe(listening);
    expect(reduceVoiceSession(listening, { type: "spoken" })).toBe(listening);
    expect(reduceVoiceSession(VOICE_SESSION_OFF, { type: "replied", reply: ANSWER })).toBe(
      VOICE_SESSION_OFF,
    );
  });
});

function message(
  id: string,
  role: VoiceMessage["role"],
  extra: Partial<VoiceMessage> = {},
): VoiceMessage {
  return { id, role, text: id, streaming: false, ...extra };
}

describe("which message answers the spoken question", () => {
  const before = [message("u1", "user"), message("a1", "assistant")];
  const anchor = replyAnchor(before);

  it("ignores everything that was there when the question was sent", () => {
    expect(selectReply(before, anchor)).toBeNull();
  });

  it("selects the answer that follows the spoken question", () => {
    const messages = [...before, message("u2", "user"), message("a2", "assistant")];
    expect(selectReply(messages, anchor)?.id).toBe("a2");
  });

  it("does not move to the answer of a follow-up that was queued behind the question", () => {
    const messages = [
      ...before,
      message("u2", "user"),
      message("a2", "assistant"),
      message("u3", "user"),
      message("a3", "assistant"),
    ];
    expect(selectReply(messages, anchor)?.id).toBe("a2");
  });

  it("skips narration the agent sent mid-turn and reads its answer", () => {
    const messages = [
      ...before,
      message("u2", "user"),
      message("a2", "assistant"),
      message("n1", "assistant", { commentary: true }),
    ];
    expect(selectReply(messages, anchor)?.id).toBe("a2");
  });

  it("reports a reply that is still streaming so the caller can wait for it", () => {
    const messages = [
      ...before,
      message("u2", "user"),
      message("a2", "assistant", { streaming: true }),
    ];
    expect(selectReply(messages, anchor)).toMatchObject({ id: "a2", streaming: true });
  });

  it("falls back to the message count when the anchor message is gone from the list", () => {
    const messages = [
      message("a1", "assistant"),
      message("u2", "user"),
      message("a2", "assistant"),
    ];
    expect(selectReply(messages, { afterId: "missing", count: 1 })?.id).toBe("a2");
  });

  it("selects the first answer of a conversation that was empty when the question was sent", () => {
    const messages = [message("u1", "user"), message("a1", "assistant")];
    expect(selectReply(messages, NOTHING_BEFORE)?.id).toBe("a1");
  });

  it("waits for the question's own row instead of taking an answer that has none before it", () => {
    expect(selectReply([message("a1", "assistant")], NOTHING_BEFORE)).toBeNull();
  });
});

describe("which answer belongs to the question voice chat sent", () => {
  const anchor = replyAnchor([message("u1", "user", { runId: "r1" })]);
  const spoken = (id: string, runId: string | null, extra: Partial<VoiceMessage> = {}) =>
    message(id, "user", { text: "why is the sky blue", runId, ...extra });

  it("skips another client's prompt that arrived first, and its answer", () => {
    const messages = [
      message("u1", "user", { runId: "r1" }),
      message("u9", "user", { text: "what time is it", runId: "r9" }),
      message("a9", "assistant", { runId: "r9" }),
      spoken("u2", "r2"),
      message("a2", "assistant", { runId: "r2" }),
    ];
    const selection = { question: "why is the sky   blue " };
    expect(selectReply(messages.slice(0, 3), anchor, selection)).toBeNull();
    expect(selectReply(messages, anchor, selection)?.id).toBe("a2");
  });

  it("takes the last answer of the question's own run, past a steer that redirected it", () => {
    const messages = [
      message("u1", "user", { runId: "r1" }),
      spoken("u2", "r2"),
      message("a2a", "assistant", { runId: "r2" }),
      message("s1", "user", { runId: "r2", steer: true, text: "also add the sunset" }),
      message("a2b", "assistant", { runId: "r2" }),
    ];
    expect(selectReply(messages, anchor, { question: "why is the sky blue" })?.id).toBe("a2b");
  });

  it("does not take a late answer of another run that lands after the question's own", () => {
    const messages = [
      message("u1", "user", { runId: "r1" }),
      spoken("u2", "r2"),
      message("a2", "assistant", { runId: "r2" }),
      message("a1b", "assistant", { runId: "r1" }),
    ];
    expect(selectReply(messages, anchor, { question: "why is the sky blue" })?.id).toBe("a2");
  });

  it("never selects a reply or a run that was already read in this conversation", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", { runId: "r1" }),
      message("a1b", "assistant", { runId: "r1" }),
      message("a1c", "assistant"),
    ];
    const first = replyAnchor([]);
    expect(selectReply(messages, first, {})?.id).toBe("a1c");
    expect(selectReply(messages, first, { readIds: ["a1c"] })?.id).toBe("a1b");
    expect(selectReply(messages, first, { readIds: ["a1c"], readRuns: ["r1"] })).toBeNull();
    expect(selectReply(messages.slice(0, 3), first, { readRuns: ["r1"] })).toBeNull();
  });

  it("remembers each reply and run it began reading", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "replied", reply: { id: "a2", text: "Light bends.", runId: "r2" } },
      { type: "spoken" },
      { type: "sent", after: NOTHING_BEFORE },
      { type: "transcribed", text: "and the sunset?" },
    ]);
    expect(state).toMatchObject({
      stage: "sending",
      readIds: ["a2"],
      readRuns: ["r2"],
      question: "and the sunset?",
    });
  });
});

describe("cards that wait for the person", () => {
  const row = (
    item: Record<string, unknown>,
    visibility: "local" | "inherited" = "local",
  ): OrchestrationV2ProjectedTurnItem =>
    ({ position: 0, visibility, item }) as unknown as OrchestrationV2ProjectedTurnItem;

  it("counts a pending secret, feedback or link request, and nothing already answered", () => {
    expect(hasPendingUserRequest([row({ type: "secret_request", secretStatus: "pending" })])).toBe(
      true,
    );
    expect(
      hasPendingUserRequest([row({ type: "feedback_request", feedbackStatus: "pending" })]),
    ).toBe(true);
    expect(hasPendingUserRequest([row({ type: "link_request", linkStatus: "pending" })])).toBe(
      true,
    );
    expect(
      hasPendingUserRequest([
        row({ type: "secret_request", secretStatus: "saved" }),
        row({ type: "feedback_request", feedbackStatus: "declined" }),
        row({ type: "link_request", linkStatus: "failed" }),
        row({ type: "assistant_message", status: "pending" }),
      ]),
    ).toBe(false);
  });

  it("ignores a pending card inherited from the thread this one was forked from", () => {
    expect(
      hasPendingUserRequest([
        row({ type: "secret_request", secretStatus: "pending" }, "inherited"),
      ]),
    ).toBe(false);
  });
});

describe("text read aloud in voice chat", () => {
  it("drops code blocks and keeps the prose around them", () => {
    expect(speakableText("Use this:\n```ts\nconst a = 1;\n```\nThen run it.")).toBe(
      "Use this:\nThen run it.",
    );
  });

  it("reads link text, not the address", () => {
    expect(speakableText("See [the guide](https://example.com/guide) first.")).toBe(
      "See the guide first.",
    );
  });

  it("removes headings, list markers and emphasis marks", () => {
    expect(speakableText("## Light\n- **Refraction** bends it\n1. _Then_ it splits")).toBe(
      "Light\nRefraction bends it\nThen it splits",
    );
  });

  it("returns an empty string for a reply that is only code", () => {
    expect(speakableText("```sh\nls\n```")).toBe("");
  });
});

describe("end of speech detection", () => {
  const options = { speechLevel: 0.1, minSpeechMs: 300, silenceMs: 1000 };

  function feed(levels: ReadonlyArray<readonly [level: number, durationMs: number]>): number[] {
    const detector = createSilenceDetector(options);
    const endings: number[] = [];
    let now = 0;
    detector.sample(0, now);
    for (const [level, durationMs] of levels) {
      for (let elapsed = 0; elapsed < durationMs; elapsed += 50) {
        now += 50;
        if (detector.sample(level, now)) endings.push(now);
      }
    }
    return endings;
  }

  it("ends the turn 1000 ms after speech stops", () => {
    expect(
      feed([
        [0.5, 600],
        [0, 2000],
      ]),
    ).toEqual([1600]);
  });

  it("does not end the turn during silence before anyone has spoken", () => {
    expect(feed([[0, 5000]])).toEqual([]);
  });

  it("does not end the turn after a noise shorter than 300 ms", () => {
    expect(
      feed([
        [0.5, 150],
        [0, 3000],
      ]),
    ).toEqual([]);
  });

  it("restarts the pause when speech resumes within 1000 ms", () => {
    expect(
      feed([
        [0.5, 600],
        [0, 700],
        [0.5, 400],
        [0, 1500],
      ]),
    ).toEqual([2700]);
  });
});
