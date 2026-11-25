import { describe, expect, it } from "vite-plus/test";

import {
  createSilenceDetector,
  reduceVoiceSession,
  speakableText,
  VOICE_SESSION_OFF,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "./voiceSession";

function run(events: ReadonlyArray<VoiceSessionEvent>): VoiceSessionState {
  return events.reduce(reduceVoiceSession, VOICE_SESSION_OFF);
}

describe("voice chat turn order", () => {
  it("goes from listening to sending, thinking, speaking and back to listening", () => {
    const stages = [
      { type: "start", threadKey: "t1" } as const,
      { type: "sent", latestAssistantMessageId: "a1" } as const,
      { type: "working" } as const,
      { type: "replied", hasNewReply: true } as const,
      { type: "spoken" } as const,
    ].reduce<string[]>((seen, _event, index, events) => {
      seen.push(run(events.slice(0, index + 1)).stage);
      return seen;
    }, []);
    expect(stages).toEqual(["listening", "sending", "thinking", "speaking", "listening"]);
  });

  it("remembers the newest reply at send time so an old reply is never read aloud", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", latestAssistantMessageId: "a1" },
    ]);
    expect(state.baselineMessageId).toBe("a1");
  });

  it("listens again when a turn ends with nothing new to read", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", latestAssistantMessageId: null },
      { type: "working" },
      { type: "replied", hasNewReply: false },
    ]);
    expect(state.stage).toBe("listening");
  });

  it("listens again when the question could not be sent", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", latestAssistantMessageId: null },
      { type: "failed" },
    ]);
    expect(state.stage).toBe("listening");
  });

  it("stops from every stage", () => {
    const turn: ReadonlyArray<VoiceSessionEvent> = [
      { type: "start", threadKey: "t1" },
      { type: "sent", latestAssistantMessageId: null },
      { type: "working" },
      { type: "replied", hasNewReply: true },
    ];
    for (let length = 1; length <= turn.length; length++) {
      const active = run(turn.slice(0, length));
      expect(reduceVoiceSession(active, { type: "stop" })).toEqual(VOICE_SESSION_OFF);
    }
  });

  it("keeps the thread it started in through a whole turn", () => {
    const state = run([
      { type: "start", threadKey: "t1" },
      { type: "sent", latestAssistantMessageId: null },
      { type: "working" },
      { type: "replied", hasNewReply: true },
      { type: "spoken" },
    ]);
    expect(state).toMatchObject({ stage: "listening", threadKey: "t1" });
  });

  it("ignores events that do not belong to the current stage", () => {
    const listening = run([{ type: "start", threadKey: "t1" }]);
    expect(reduceVoiceSession(listening, { type: "working" })).toBe(listening);
    expect(reduceVoiceSession(listening, { type: "spoken" })).toBe(listening);
    expect(reduceVoiceSession(VOICE_SESSION_OFF, { type: "replied", hasNewReply: true })).toBe(
      VOICE_SESSION_OFF,
    );
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
