import { expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { OneMark } from "./OneMark";
import { OneVoiceStage } from "./OneVoiceStage";
import {
  commitVoiceThread,
  publishVoiceBridge,
  retractVoiceBridge,
  type VoiceBridge,
} from "./voiceBridge";
import { dispatchVoiceSession } from "./voiceSession";
import { rememberVoiceLauncher } from "./voiceStageMotion";
import { setWorkspaceMode } from "./workspaceMode";

/** The stage with its real styles. The microphone is the one faked part: it records until told to stop. */
function setup() {
  setWorkspaceMode("chat");
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

/** Waits for every finite animation and transition to land, so computed styles are the resting ones. */
async function settle() {
  await Promise.all(
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)),
  );
}

const stageElement = () => document.querySelector<HTMLElement>("[data-one-voice-stage]")!;
const look = () => stageElement().dataset.look;

function signature() {
  const stage = stageElement();
  const style = (selector: string) => getComputedStyle(stage.querySelector(selector)!);
  return {
    look: look(),
    label: stage.querySelector(".one-voice-status-text")!.textContent,
    glyph: stage.querySelector(".one-voice-status-glyph")!.innerHTML.slice(0, 60),
    glyphColor: style(".one-voice-status-glyph").color,
    ring: style(".one-voice-ring").opacity,
    ringStyle: style(".one-voice-ring").borderTopStyle,
    ringColor: style(".one-voice-ring").borderTopColor,
    arc: style(".one-voice-arc").opacity,
    arcMotion: style(".one-voice-arc").animationName,
    ripples: style(".one-voice-ripple").animationName,
  };
}

const waitingTurn = () => {
  dispatchVoiceSession({ type: "sent", after: { afterId: null, count: 0 }, submission: "s1" });
  dispatchVoiceSession({ type: "working" });
};

it("every state of voice chat differs from every other in its label, glyph and shape, not only in color", async () => {
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
    JSON.stringify([
      found.label,
      found.glyph,
      found.ring,
      found.ringStyle,
      found.arc,
      found.ripples,
    ]),
  );
  expect(new Set(shapes).size).toBe(seen.size);
  // Listening holds the halo still; thinking turns an arc in its place; speaking sends ripples out.
  expect(seen.get("listening")).toMatchObject({ ring: "1", arc: "0", ripples: "none" });
  expect(seen.get("thinking")).toMatchObject({ ring: "0", arc: "1", arcMotion: "one-voice-turn" });
  expect(seen.get("speaking")).toMatchObject({ arc: "0", ripples: "one-voice-ripple" });
  expect(seen.get("muted")).toMatchObject({ ringStyle: "dashed" });
  // Each state that needs the person, or failed, takes its own status color.
  expect(seen.get("notice")!.glyphColor).not.toBe(seen.get("listening")!.glyphColor);
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
    // Label and glyph are left out on purpose: this is what the picture says without any words.
    shapes.set(
      look()!,
      JSON.stringify([
        style(".one-voice-ring").opacity,
        style(".one-voice-ring").borderTopStyle,
        style(".one-voice-ring").borderTopColor,
        style(".one-voice-arc").opacity,
        style(".one-voice-ripple").opacity,
        style(".one-voice-ripple").transform,
        style(".one-voice-ripple", 1).opacity,
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
