import { expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import "~/index.css";
import { act, fakeTimers, render } from "../../test/render";
import { OneMark } from "./OneMark";
import { OneVoiceStage } from "./OneVoiceStage";
import {
  commitVoiceThread,
  publishVoiceBridge,
  retractVoiceBridge,
  type VoiceBridge,
} from "./voiceBridge";
import { dispatchVoiceSession, useVoiceStageOpen } from "./voiceSession";
import { rememberVoiceLauncher } from "./voiceStageMotion";
import { setWorkspaceMode } from "./workspaceMode";

/** The stage with its real styles. The microphone is the one faked part: it records until told to stop. */
function setup() {
  setWorkspaceMode("chat");
  // The count of sessions that showed the key hints belongs to the browser; every test starts with none.
  window.localStorage.removeItem("one:voice-hint-sessions");
  const state = { phase: "recording" as VoiceBridge["phase"] };
  const publish = () => {
    commitVoiceThread("look", "thread-a", () => false);
    publishVoiceBridge("look", {
      threadKey: "thread-a",
      isDraft: false,
      continuesDraft: () => false,
      available: true,
      needsSetup: false,
      draftEmpty: true,
      phase: state.phase,
      error: null,
      heard: state.phase === "recording" ? "why is the sky blue" : "",
      start: () => Promise.resolve("started"),
      submit: () => undefined,
      cancel: () => {
        state.phase = "idle";
        publish();
      },
    });
  };
  publish();
  // Reading aloud is the other faked part: nothing is spoken on the machine running the test.
  const speak = vi.spyOn(window.speechSynthesis, "speak").mockImplementation(() => undefined);
  return {
    state,
    publish,
    [Symbol.dispose]() {
      dispatchVoiceSession({ type: "stop" });
      retractVoiceBridge("look");
      speak.mockRestore();
      setWorkspaceMode("code");
    },
  };
}

function Scene({ isWorking = false }: { readonly isWorking?: boolean }) {
  return (
    <div style={{ position: "relative", width: 900, height: 700 }}>
      <button type="button" id="launcher" style={{ position: "absolute", left: 40, top: 640 }}>
        Voice
      </button>
      <OneVoiceStage threadRef={null} isWorking={isWorking} needsUser={false} draftMessages={[]} />
    </div>
  );
}

/** Ends every finite animation and transition, so computed styles are the resting ones. */
async function settle() {
  const finite = document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
  for (const animation of finite) animation.finish();
  await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
}

const stageElement = () => document.querySelector<HTMLElement>("[data-one-voice-stage]")!;
const look = () => stageElement().dataset.look;

function signature() {
  const stage = stageElement();
  const style = (selector: string) => getComputedStyle(stage.querySelector(selector)!);
  return {
    look: look(),
    label: stage.querySelector(".one-voice-status")!.textContent,
    labelColor: style(".one-voice-status").color,
    ring: style(".one-voice-ring").opacity,
    ringStyle: style(".one-voice-ring").borderTopStyle,
    ringColor: style(".one-voice-ring").borderTopColor,
    ripples: style(".one-voice-ripple").animationName,
  };
}

const waitingTurn = () => {
  dispatchVoiceSession({ type: "sent", after: { afterId: null, count: 0 }, submission: "s1" });
  dispatchVoiceSession({ type: "working" });
};

it("every state of voice chat differs from every other in its word and shape, not only in color", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene isWorking />, { router: false });
  const seen = new Map<string, ReturnType<typeof signature>>();
  const capture = async () => {
    await settle();
    const found = signature();
    seen.set(found.look!, found);
  };

  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await capture();
  await act(() => dispatchVoiceSession({ type: "muted", muted: true }));
  await capture();
  await act(() => dispatchVoiceSession({ type: "muted", muted: false }));
  await act(waitingTurn);
  await capture();
  await act(() =>
    dispatchVoiceSession({ type: "replied", reply: { id: "r1", text: "Light bends." } }),
  );
  await capture();
  await act(() => dispatchVoiceSession({ type: "stop" }));
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await act(waitingTurn);
  await act(() =>
    dispatchVoiceSession({
      type: "replied",
      reply: { id: "n1", text: "Lost the connection.", kind: "notice" },
    }),
  );
  await capture();

  expect([...seen.keys()].toSorted()).toEqual([
    "listening",
    "muted",
    "notice",
    "speaking",
    "thinking",
  ]);
  const shapes = [...seen.values()].map((found) =>
    JSON.stringify([found.label, found.ring, found.ringStyle, found.ripples]),
  );
  expect(new Set(shapes).size).toBe(seen.size);
  // Listening holds one hairline still; speaking sends a ripple out of it; thinking has none,
  // because the ring itself carries that state; muted draws it dashed.
  expect(seen.get("listening")).toMatchObject({ ring: "1", ripples: "none" });
  expect(seen.get("thinking")).toMatchObject({ ring: "0" });
  expect(seen.get("speaking")).toMatchObject({ ripples: "one-voice-ripple" });
  expect(seen.get("muted")).toMatchObject({ ringStyle: "dashed" });
  // The state that needs the person takes its own color for the word.
  expect(seen.get("notice")!.labelColor).not.toBe(seen.get("listening")!.labelColor);
});

it("no orbit arcs or concentric extras surround the ring: one hairline, one ripple, one word", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene isWorking />, { router: false });
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await act(waitingTurn);
  await settle();
  const stage = stageElement();
  expect(stage.querySelectorAll(".one-voice-ring")).toHaveLength(1);
  expect(stage.querySelectorAll(".one-voice-ripple")).toHaveLength(1);
  expect(stage.querySelector(".one-voice-arc, svg[data-glyph]")).toBeNull();
  // The status is one serif italic word, not a pill: no border, no background.
  const status = getComputedStyle(stage.querySelector(".one-voice-status")!);
  expect(status.fontStyle).toBe("italic");
  expect(status.fontFamily).toMatch(/Iowan|Palatino|Georgia|serif/);
  expect(status.borderTopWidth).toBe("0px");
  expect(status.backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

it("the stage is a dark scene with the transcript set in the serif face, whatever the theme", async () => {
  using _voice = setup();
  document.documentElement.classList.remove("dark");
  await using _screen = await render(<Scene />, { router: false });

  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await settle();
  const stage = stageElement();
  expect(getComputedStyle(stage).backgroundImage).toContain("radial-gradient");
  expect(getComputedStyle(stage).colorScheme).toBe("dark");
  expect(getComputedStyle(stage.querySelector(".one-voice-caption")!).fontFamily).toMatch(
    /Iowan|Palatino|Georgia|serif/,
  );
});

it("the ring arrives from the control that opened voice chat, even when the browser did not focus it, and flies back to it when voice chat ends", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  const launcher = document.querySelector<HTMLElement>("#launcher")!;
  // Safari leaves a clicked button unfocused: the control is noted at the click instead.
  rememberVoiceLauncher(launcher);
  const centerOf = (element: Element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { x: left + width / 2, y: top + height / 2 };
  };
  const translation = (transform: unknown) => {
    const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(transform)) ?? [];
    return { x: Number(x), y: Number(y) };
  };

  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  const orbWrap = stageElement().querySelector<HTMLElement>(".one-voice-orb-wrap")!;
  const [arrival] = orbWrap.getAnimations();
  const first = (arrival!.effect as KeyframeEffect).getKeyframes()[0]!;
  const from = translation(first.transform);
  expect(first.opacity).toBe("0");
  // The ring's resting place is measured once the arrival has landed.
  await act(() => settle());
  const rest = centerOf(orbWrap);
  const origin = centerOf(launcher);
  expect(from.x).toBeCloseTo(origin.x - rest.x, 0);
  expect(from.y).toBeCloseTo(origin.y - rest.y, 0);

  await act(() => dispatchVoiceSession({ type: "stop" }));
  expect(document.querySelector("[role=dialog]")).toBeNull();
  const ghost = document.querySelector<HTMLElement>(".one-voice-ghost")!;
  expect(ghost).not.toBeNull();
  const ghostOrb = ghost.querySelector<HTMLElement>(".one-voice-ghost-orb")!;
  const keyframes = (ghostOrb.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes();
  const to = translation(keyframes.at(-1)!.transform);
  expect(to.x).toBeCloseTo(origin.x - rest.x, 0);
  expect(to.y).toBeCloseTo(origin.y - rest.y, 0);
  // The exit takes 0.7 of the arrival, as the motion contract says.
  const exitMs = Number(ghostOrb.getAnimations()[0]!.effect!.getTiming().duration);
  expect(exitMs).toBeCloseTo(320 * 0.7, 0);

  await act(() => settle());
  expect(document.querySelector(".one-voice-ghost")).toBeNull();
});

it("the flat mark the orb falls back to is the dark one on the dark stage, in a light theme too", async () => {
  document.documentElement.classList.remove("dark");
  await using _screen = await render(
    <div className="one-voice-stage" data-look="listening">
      <OneMark size={128} />
    </div>,
    { router: false },
  );
  const shown = (theme: string) =>
    getComputedStyle(document.querySelector(`img[data-mark-theme="${theme}"]`)!).display;
  expect(shown("dark")).toBe("block");
  expect(shown("light")).toBe("none");
});

it("with motion reduced, every state of voice chat still differs from every other by its drawn shape alone", async () => {
  using _voice = setup();
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  using _motion = {
    [Symbol.dispose]: () =>
      void cdp().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "" }],
      }),
  };
  await using _screen = await render(<Scene isWorking />, { router: false });
  const shapes = new Map<string, string>();
  const capture = async () => {
    await settle();
    const stage = stageElement();
    const style = (selector: string, index = 0) =>
      getComputedStyle(stage.querySelectorAll(selector)[index]!);
    // The word is left out on purpose: this is what the picture says without any words.
    shapes.set(
      look()!,
      JSON.stringify([
        style(".one-voice-ring").opacity,
        style(".one-voice-ring").borderTopStyle,
        style(".one-voice-ring").borderTopColor,
        style(".one-voice-ripple").opacity,
        style(".one-voice-ripple").transform,
      ]),
    );
  };

  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await capture();
  await act(() => dispatchVoiceSession({ type: "muted", muted: true }));
  await capture();
  await act(() => dispatchVoiceSession({ type: "muted", muted: false }));
  await act(waitingTurn);
  await capture();
  await act(() =>
    dispatchVoiceSession({ type: "replied", reply: { id: "r1", text: "Light bends." } }),
  );
  await capture();
  await act(() => document.querySelector<HTMLElement>(".one-voice-orb-button")!.click());
  await capture();
  await act(() => dispatchVoiceSession({ type: "stop" }));
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await act(waitingTurn);
  await act(() =>
    dispatchVoiceSession({
      type: "replied",
      reply: { id: "n1", text: "Lost the connection.", kind: "notice" },
    }),
  );
  await capture();

  expect([...shapes.keys()].toSorted()).toEqual([
    "interrupted",
    "listening",
    "muted",
    "notice",
    "speaking",
    "thinking",
  ]);
  expect(new Set(shapes.values()).size).toBe(shapes.size);
});

it("the controls are round 56 px glass buttons with an accessible name, and their label shows on focus and not before", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await settle();

  const buttons = [...stageElement().querySelectorAll<HTMLButtonElement>(".one-voice-control")];
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Mute microphone",
    "End voice chat",
  ]);
  for (const button of buttons) {
    const style = getComputedStyle(button);
    expect(button.getBoundingClientRect().width).toBe(56);
    expect(button.getBoundingClientRect().height).toBe(56);
    expect(style.borderTopLeftRadius).toBe("50%");
    expect(style.backdropFilter).toContain("blur");
    // Icon only: no text a screen reader or an eye would read besides the hidden label.
    expect(button.querySelector("svg")).not.toBeNull();
    expect(getComputedStyle(button.querySelector(".one-voice-control-label")!).opacity).toBe("0");
  }
  const mute = buttons[0]!;
  await act(() => mute.focus({ focusVisible: true } as FocusOptions));
  await settle();
  const label = mute.querySelector(".one-voice-control-label")!;
  expect(label.textContent).toBe("Mute microphone");
  expect(getComputedStyle(label).opacity).toBe("1");
  expect(mute.getAttribute("aria-keyshortcuts")).toBe("M");
});

it("the key hints fade after 3 seconds without input and come back on a key press or a pointer move", async () => {
  using _voice = setup();
  using _timers = fakeTimers();
  await using _screen = await render(<Scene />, { router: false });
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));

  expect(stageElement().dataset.hints).toBe("on");
  await act(() => vi.advanceTimersByTime(2_999));
  expect(stageElement().dataset.hints).toBe("on");
  await act(() => vi.advanceTimersByTime(1));
  expect(stageElement().dataset.hints).toBe("off");

  await act(() => void window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })));
  expect(stageElement().dataset.hints).toBe("on");
  await act(() => vi.advanceTimersByTime(3_000));
  expect(stageElement().dataset.hints).toBe("off");
  await act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
  expect(stageElement().dataset.hints).toBe("on");
});

it("the key hints are drawn at 40 percent opacity when shown and are gone when faded", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  const opacity = () => getComputedStyle(stageElement().querySelector(".one-voice-hints")!).opacity;

  stageElement().dataset.hints = "on";
  await settle();
  expect(Number(opacity())).toBeCloseTo(0.4, 2);
  stageElement().dataset.hints = "off";
  await settle();
  expect(opacity()).toBe("0");
});

it("after three sessions the key hints stay hidden until the person presses a key or moves the pointer", async () => {
  using _voice = setup();
  using _timers = fakeTimers();
  await using _screen = await render(<Scene />, { router: false });
  window.localStorage.setItem("one:voice-hint-sessions", "3");

  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  expect(stageElement().dataset.hints).toBe("off");
  await act(() => void window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })));
  expect(stageElement().dataset.hints).toBe("on");
});

it("the first three sessions count toward hiding the hints", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  for (let session = 1; session <= 3; session += 1) {
    await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
    expect(stageElement().dataset.hints).toBe("on");
    await act(() => dispatchVoiceSession({ type: "stop" }));
  }
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  expect(stageElement().dataset.hints).toBe("off");
});

it("when voice chat ends the ring stays solid until it is the size of the control, then a glint catches there", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  const launcher = document.querySelector<HTMLElement>("#launcher")!;
  rememberVoiceLauncher(launcher);
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await act(() => settle());

  await act(() => dispatchVoiceSession({ type: "stop" }));
  const ghost = document.querySelector<HTMLElement>(".one-voice-ghost")!;
  const ring = (ghost.querySelector(".one-voice-ghost-orb") as HTMLElement).getAnimations()[0]!;
  const keyframes = (ring.effect as KeyframeEffect).getKeyframes();
  // Opaque almost to the end of the flight, so it does not vanish while still large.
  expect(keyframes.find((frame) => frame.offset === 0.9)?.opacity).toBe("1");
  expect(keyframes.at(-1)?.opacity).toBe("0");
  const scale = Number(/scale\(([\d.]+)\)/.exec(String(keyframes.at(-1)?.transform))?.[1]);
  const box = launcher.getBoundingClientRect();
  const ringWidth = (ghost.querySelector(".one-voice-ghost-orb") as HTMLElement).offsetWidth;
  expect(ringWidth * scale).toBeLessThanOrEqual(Math.max(box.width, 40));

  // The glint is centred on the control and starts as the ring lands.
  const glint = ghost.querySelector<HTMLElement>(".one-voice-ghost-glint")!;
  const glintBox = glint.getBoundingClientRect();
  expect(glintBox.left + glintBox.width / 2).toBeCloseTo(box.left + box.width / 2, -1);
  const timing = glint.getAnimations()[0]!.effect!.getTiming();
  const flightMs = Number(ring.effect!.getTiming().duration);
  expect(Number(timing.delay)).toBeCloseTo(flightMs * 0.82, 0);
  expect(Number(timing.duration)).toBeGreaterThan(200);

  await act(() => settle());
  expect(document.querySelector(".one-voice-ghost")).toBeNull();
});

it("the page behind stays held through the exit beat, so it is not brought up to date mid-flight, and toasts wait for the ring to land", async () => {
  using _voice = setup();
  function Probe() {
    return <output data-testid="held">{String(useVoiceStageOpen())}</output>;
  }
  await using _screen = await render(
    <>
      <Probe />
      <Scene />
    </>,
    { router: false },
  );
  const held = () => document.querySelector("[data-testid=held]")!.textContent;
  expect(held()).toBe("false");
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  expect(held()).toBe("true");

  await act(() => dispatchVoiceSession({ type: "stop" }));
  // The stage is gone; its ghost is still flying home.
  expect(document.querySelector("[data-one-voice-stage]")).toBeNull();
  expect(document.querySelector(".one-voice-ghost")).not.toBeNull();
  expect(held()).toBe("true");

  await act(() => settle());
  expect(document.querySelector(".one-voice-ghost")).toBeNull();
  expect(held()).toBe("false");
});

it("the exit is already on screen in the same commit that closes the stage", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await act(() => settle());
  const states: Array<[boolean, boolean]> = [];
  const watch = new MutationObserver(() =>
    states.push([
      document.querySelector("[data-one-voice-stage]") !== null,
      document.querySelector(".one-voice-ghost") !== null,
    ]),
  );
  watch.observe(document.body, { childList: true, subtree: true });
  using _stop = { [Symbol.dispose]: () => watch.disconnect() };

  await act(() => dispatchVoiceSession({ type: "stop" }));
  await Promise.resolve();
  // No observed state has neither the stage nor the ghost: no frame can show the page between them.
  expect(states.length).toBeGreaterThan(0);
  expect(states.some(([stage, ghost]) => !stage && !ghost)).toBe(false);
});

it("the landing glint is still visible halfway through its time, not spent in its first quarter", async () => {
  using _voice = setup();
  await using _screen = await render(<Scene />, { router: false });
  rememberVoiceLauncher(document.querySelector<HTMLElement>("#launcher")!);
  await act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" }));
  await act(() => settle());
  await act(() => dispatchVoiceSession({ type: "stop" }));
  const glint = document.querySelector<HTMLElement>(".one-voice-ghost-glint")!;
  const animation = glint.getAnimations()[0]!;
  animation.pause();
  const { delay, duration } = animation.effect!.getTiming();
  const opacityAt = (fraction: number) => {
    animation.currentTime = Number(delay) + Number(duration) * fraction;
    return Number(getComputedStyle(glint).opacity);
  };
  expect(opacityAt(0)).toBe(0);
  expect(opacityAt(0.3)).toBeGreaterThan(0.95);
  expect(opacityAt(0.5)).toBeGreaterThan(0.3);
  expect(opacityAt(1)).toBe(0);
});
