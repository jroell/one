import { describe, expect, it } from "vite-plus/test";

import { startSpeech, type ChunkEvents, type SpeechEngine } from "./speechOutput";

/** Lets the reading loop take every step it can without a clock: it only awaits promises. */
async function settle() {
  for (let step = 0; step < 20; step += 1) await Promise.resolve();
}

/** An engine whose chunks finish only when the test says so. */
function fakeEngine(input: { remote?: boolean; failOn?: string } = {}) {
  const played: string[] = [];
  const prepared: string[] = [];
  const pending: Array<{ text: string; finish: () => void; events: ChunkEvents }> = [];
  const engine: SpeechEngine = {
    remote: input.remote ?? false,
    prepare: (chunk) => {
      prepared.push(chunk.text);
      return {
        release: () => undefined,
        play: (events, signal) =>
          new Promise<void>((resolve, reject) => {
            if (input.failOn !== undefined && chunk.text.includes(input.failOn)) {
              reject(new Error("voice failed"));
              return;
            }
            played.push(chunk.text);
            events.onStart();
            signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError")));
            pending.push({ text: chunk.text, finish: resolve, events });
          }),
      };
    },
  };
  const finishNext = async () => {
    await settle();
    pending.shift()?.finish();
    await settle();
  };
  return { engine, played, prepared, pending, finishNext };
}

describe("startSpeech", () => {
  it("reads every chunk of a finished text in order, then reports finished", async () => {
    const fake = fakeEngine({ remote: true });
    const playback = startSpeech(fake.engine, null);
    playback.update("One. Two is longer than one and keeps going.", true);
    await fake.finishNext();
    await fake.finishNext();
    await expect(playback.done).resolves.toBe("finished");
    expect(fake.played).toEqual(["One.", "Two is longer than one and keeps going."]);
  });

  it("starts reading a reply that is still being written, and reads what arrives later after it", async () => {
    const fake = fakeEngine({ remote: true });
    const playback = startSpeech(fake.engine, null);
    playback.update("The first sentence is done.", false);
    await settle();
    expect(fake.played).toEqual(["The first sentence is done."]);
    await expect(Promise.race([playback.done, Promise.resolve("still reading")])).resolves.toBe(
      "still reading",
    );

    playback.update("The first sentence is done. The second is still going.", true);
    await fake.finishNext();
    await fake.finishNext();
    await expect(playback.done).resolves.toBe("finished");
    expect(fake.played).toEqual(["The first sentence is done.", "The second is still going."]);
  });

  it("prepares the next chunks while the current one plays, so a fetched voice has no gap", async () => {
    const fake = fakeEngine({ remote: true });
    const playback = startSpeech(fake.engine, null);
    playback.update(
      "Alpha one. Bravo is the second one here. Charlie is the third one here.",
      true,
    );
    await settle();
    expect(fake.played).toEqual(["Alpha one."]);
    expect(fake.prepared.length).toBeGreaterThanOrEqual(2);
    playback.stop();
    await expect(playback.done).resolves.toBe("stopped");
  });

  it("switches to the device voice for the rest of the reading when the cloud voice fails, and says so once", async () => {
    const cloud = fakeEngine({ remote: true, failOn: "Second" });
    const device = fakeEngine();
    const fallbacks: unknown[] = [];
    const playback = startSpeech(cloud.engine, device.engine, {
      onFallback: (error) => fallbacks.push(error),
    });
    playback.update("First part. Second part here. Third part follows.", true);
    await cloud.finishNext();
    await device.finishNext();
    await device.finishNext();
    await expect(playback.done).resolves.toBe("finished");
    expect(cloud.played).toEqual(["First part."]);
    expect(device.played.join(" ")).toBe("Second part here. Third part follows.");
    expect(fallbacks).toHaveLength(1);
  });

  it("reports progress as offsets into the whole text", async () => {
    const fake = fakeEngine({ remote: true });
    const offsets: number[] = [];
    const playback = startSpeech(fake.engine, null, {
      onProgress: (offset) => offsets.push(offset),
    });
    playback.update("Hello there. General greeting follows now.", true);
    await settle();
    await fake.finishNext();
    fake.pending[0]?.events.onProgress(8);
    expect(offsets).toEqual([21]);
    playback.stop();
  });

  it("stops at once and reports stopped", async () => {
    const fake = fakeEngine();
    const playback = startSpeech(fake.engine, null);
    playback.update("Something long enough to read.", true);
    await settle();
    playback.stop();
    await expect(playback.done).resolves.toBe("stopped");
  });
});
