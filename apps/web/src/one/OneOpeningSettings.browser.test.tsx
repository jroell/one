import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { page } from "vite-plus/test/browser";

import { render, stubGlobal } from "../../test/render";
import { OneOpening } from "./OneOpening";
import { OneOpeningSettings } from "./OneOpeningSettings";
import { OPENING_SEEN_KEY, setOpeningPreferences } from "./openingPreferences";
import { playOpeningSound } from "./openingSound";

/** An audio context that only records how it was used. */
function fakeAudio() {
  const made: Array<{ resumes: number; state: string }> = [];
  class FakeAudioContext {
    state = "suspended";
    currentTime = 0;
    resumes = 0;
    constructor() {
      made.push(this);
    }
    resume() {
      this.resumes += 1;
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
    // The sound itself is not under test: a node graph that accepts every call.
    createGain = () => audioNode();
    createDelay = () => audioNode();
    createBiquadFilter = () => audioNode();
    createOscillator = () => audioNode();
    destination = {};
  }
  const stub = stubGlobal("AudioContext", FakeAudioContext);
  return { made, [Symbol.dispose]: () => stub[Symbol.dispose]() };
}

function audioNode(): Record<string, unknown> {
  const param = {
    value: 0,
    setValueAtTime: () => param,
    exponentialRampToValueAtTime: () => param,
    cancelScheduledValues: () => param,
  };
  const node: Record<string, unknown> = {
    gain: param,
    frequency: param,
    delayTime: param,
    Q: param,
    start: () => {},
    stop: () => {},
  };
  node.connect = (next: unknown) => next ?? node;
  return node;
}

it("Play it now with the sound on unlocks audio inside the click, before the opening asks for it", async () => {
  using audio = fakeAudio();
  setOpeningPreferences({ animation: true, sound: true });
  // The context waits for an opening to take it; take it here so no test inherits it.
  onTestFinished(() => playOpeningSound(0)());
  // No opening is mounted, so nothing but the click itself can have created the context.
  await using screen = await render(<OneOpeningSettings />, { router: false });

  await screen.getByRole("button", { name: "Play it now" }).click();

  expect(audio.made).toHaveLength(1);
  expect(audio.made[0]?.resumes).toBeGreaterThanOrEqual(1);
});

it("Play it now with the sound off does not touch audio", async () => {
  using audio = fakeAudio();
  setOpeningPreferences({ animation: true, sound: false });
  onTestFinished(() => setOpeningPreferences({ sound: true }));
  await using screen = await render(<OneOpeningSettings />, { router: false });

  await screen.getByRole("button", { name: "Play it now" }).click();

  expect(audio.made).toHaveLength(0);
});

it("the replayed opening plays on the context the click unlocked instead of creating another", async () => {
  using audio = fakeAudio();
  window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
  setOpeningPreferences({ animation: true, sound: true });
  const original = window.matchMedia.bind(window);
  using _motion = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? "not all" : query),
    );
  await using screen = await render(
    <>
      <OneOpening />
      <OneOpeningSettings />
    </>,
    { router: false },
  );

  await screen.getByRole("button", { name: "Play it now" }).click();

  await expect.element(page.getByRole("dialog", { name: "One is opening" })).toBeInTheDocument();
  expect(audio.made).toHaveLength(1);
});
