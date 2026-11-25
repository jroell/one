import { describe, expect, it, vi } from "vite-plus/test";

import { commitVoiceThread, retractVoiceBridge, whileCommitted } from "./voiceBridge";
import {
  beginMicrophone,
  dispatchVoiceSession,
  getVoiceSession,
  settleMicrophone,
} from "./voiceSession";

const NEVER_A_DRAFT = () => false;

/** Opens a conversation for the test and closes it, and forgets the committed thread, afterwards. */
function conversation(event: { threadKey: string; isDraft?: boolean }): Disposable {
  dispatchVoiceSession({ type: "start", ...event });
  return {
    [Symbol.dispose]() {
      dispatchVoiceSession({ type: "stop" });
      retractVoiceBridge("composer");
    },
  };
}

describe("voice chat follows the thread the composer has committed", () => {
  it("ends a conversation in the commit that shows another thread", () => {
    using _open = conversation({ threadKey: "thread-a" });
    commitVoiceThread("composer", "thread-a", NEVER_A_DRAFT);
    expect(getVoiceSession().stage).toBe("listening");

    commitVoiceThread("composer", "thread-b", NEVER_A_DRAFT);
    expect(getVoiceSession().stage).toBe("off");
  });

  it("keeps a conversation going when the new thread is the draft its first question was sent from", () => {
    using _open = conversation({ threadKey: "draft-1", isDraft: true });
    dispatchVoiceSession({ type: "sent", after: { afterId: null, count: 0 } });

    commitVoiceThread("composer", "thread-9", (draftKey) => draftKey === "draft-1");
    expect(getVoiceSession()).toMatchObject({ stage: "sending", threadKey: "thread-9" });
  });

  it("ends a draft conversation that is still listening when the thread changes", () => {
    using _open = conversation({ threadKey: "draft-1", isDraft: true });
    commitVoiceThread("composer", "thread-9", () => true);
    expect(getVoiceSession().stage).toBe("off");
  });

  it("makes controls published for the old thread do nothing after the new thread is committed", () => {
    using _open = conversation({ threadKey: "thread-a" });
    const submitOld = vi.fn();
    const submitNew = vi.fn();
    commitVoiceThread("composer", "thread-a", NEVER_A_DRAFT);
    whileCommitted("composer", "thread-a", submitOld);
    expect(submitOld).toHaveBeenCalledTimes(1);

    commitVoiceThread("composer", "thread-b", NEVER_A_DRAFT);
    whileCommitted("composer", "thread-a", submitOld);
    whileCommitted("composer", "thread-b", submitNew);
    expect(submitOld).toHaveBeenCalledTimes(1);
    expect(submitNew).toHaveBeenCalledTimes(1);
  });

  it("makes controls do nothing once the composer withdrew", () => {
    using _open = conversation({ threadKey: "thread-a" });
    const submit = vi.fn();
    commitVoiceThread("composer", "thread-a", NEVER_A_DRAFT);
    retractVoiceBridge("composer");
    whileCommitted("composer", "thread-a", submit);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("the microphone operation a conversation owns", () => {
  it("cancels the recording and aborts its start when the conversation ends", () => {
    using _open = conversation({ threadKey: "thread-a" });
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    beginMicrophone((given) => {
      signal = given;
    }, cancel);
    expect(signal?.aborted).toBe(false);

    dispatchVoiceSession({ type: "stop" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
  });

  it("registers the cancellation before the start runs, for a retry as well as a first attempt", () => {
    using _open = conversation({ threadKey: "thread-a" });
    const cancelRetry = vi.fn();
    beginMicrophone(() => undefined, vi.fn());
    beginMicrophone(() => dispatchVoiceSession({ type: "stop" }), cancelRetry);
    // The start itself ended the conversation: the cancellation was already in place.
    expect(cancelRetry).toHaveBeenCalledTimes(1);
  });

  it("aborts the attempt a retry replaces without cancelling the recorder", () => {
    using _open = conversation({ threadKey: "thread-a" });
    const cancelFirst = vi.fn();
    let first: AbortSignal | undefined;
    beginMicrophone((signal) => {
      first = signal;
    }, cancelFirst);
    beginMicrophone(() => undefined, vi.fn());
    expect(first?.aborted).toBe(true);
    expect(cancelFirst).not.toHaveBeenCalled();
  });

  it("does not cancel a recording that already settled, but still tells a waiting start to give up", () => {
    using _open = conversation({ threadKey: "thread-a" });
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    beginMicrophone((given) => {
      signal = given;
    }, cancel);
    settleMicrophone();
    dispatchVoiceSession({ type: "stop" });
    expect(cancel).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
  });

  it("starts nothing once the conversation is over", () => {
    const start = vi.fn();
    beginMicrophone(start, vi.fn());
    expect(start).not.toHaveBeenCalled();
  });
});
