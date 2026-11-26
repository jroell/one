import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../test/render";
import {
  getWorkspaceMode,
  setWorkspaceMode,
  useWorkspaceMode,
  type WorkspaceMode,
} from "./workspaceMode";

const root = () => document.documentElement.dataset;

function startInCodeMode() {
  setWorkspaceMode("code");
  return {
    [Symbol.dispose]() {
      setWorkspaceMode("code");
    },
  };
}

/** Motion is allowed whatever the machine running the test prefers. */
function motionAllowed(): Disposable {
  const original = window.matchMedia.bind(window);
  return vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? "not all" : query),
    );
}

/** Cross-fades the test finishes by hand: the browser's own timing would make the order a guess. */
function manualTransitions() {
  const started: Array<{ swap: () => void; finish: () => void }> = [];
  const spy = vi.spyOn(document, "startViewTransition").mockImplementation((update) => {
    const finished = Promise.withResolvers<void>();
    started.push({
      swap: () => void (typeof update === "function" ? update() : undefined),
      finish: () => finished.resolve(),
    });
    return {
      ready: Promise.resolve(),
      finished: finished.promise,
      updateCallbackDone: Promise.resolve(),
      skipTransition: () => {},
    } as unknown as ViewTransition;
  });
  return { started, [Symbol.dispose]: () => spy.mockRestore() };
}

it("a cross-fading switch changes the store and the page together, when the browser swaps the layouts", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using fades = manualTransitions();
  const seen: Array<readonly [WorkspaceMode, string | undefined]> = [];
  function Probe() {
    const mode = useWorkspaceMode();
    // Records what the page showed at the moment React rendered this mode.
    useLayoutEffect(() => {
      seen.push([mode, root().oneMode]);
    });
    return null;
  }
  await using _screen = await render(<Probe />, { router: false });

  setWorkspaceMode("chat", { transition: true });
  expect(getWorkspaceMode()).toBe("code");
  expect(root().oneMode).toBe("code");

  await act(() => fades.started[0]?.swap());
  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");
  expect(seen.at(-1)).toEqual(["chat", "chat"]);
  expect(seen.every(([mode, attribute]) => mode === attribute)).toBe(true);
});

it("two quick cross-fading switches end in the last mode with the page and store agreeing and no stale marker", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using fades = manualTransitions();

  setWorkspaceMode("chat", { transition: true });
  setWorkspaceMode("code", { transition: true });
  expect(fades.started).toHaveLength(2);
  const secondMarker = root().oneModeTransition;
  expect(secondMarker).toBeDefined();

  // The browser runs both swaps, then reports the first cross-fade finished while the second runs.
  fades.started[0]?.swap();
  fades.started[1]?.swap();
  fades.started[0]?.finish();
  await Promise.resolve();
  expect(root().oneModeTransition).toBe(secondMarker);

  fades.started[1]?.finish();
  await Promise.resolve();
  expect(root().oneModeTransition).toBeUndefined();
  expect(getWorkspaceMode()).toBe("code");
  expect(root().oneMode).toBe("code");
});

it("a superseded cross-fade finishing before the newer one swaps does not apply the newer mode early", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using fades = manualTransitions();

  setWorkspaceMode("chat", { transition: true });
  await act(() => fades.started[0]?.swap());
  expect(getWorkspaceMode()).toBe("chat");

  setWorkspaceMode("code", { transition: true });
  fades.started[0]?.finish();
  await Promise.resolve();
  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");

  await act(() => fades.started[1]?.swap());
  expect(getWorkspaceMode()).toBe("code");
  expect(root().oneMode).toBe("code");
  fades.started[1]?.finish();
});

it("a cross-fade the browser refuses still switches the page and the store and leaves no marker", () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using _refuse = vi.spyOn(document, "startViewTransition").mockImplementation(() => {
    throw new DOMException("Transition could not start", "InvalidStateError");
  });

  expect(() => setWorkspaceMode("chat", { transition: true })).not.toThrow();

  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");
  expect(root().oneModeTransition).toBeUndefined();
  expect(window.localStorage.getItem("one:workspace-mode")).toBe("chat");
});

it("a plain switch lands at once, even while a cross-fade to the same mode is waiting", () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using fades = manualTransitions();

  setWorkspaceMode("chat", { transition: true });
  setWorkspaceMode("chat");

  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");
  fades.started[0]?.finish();
});

it("a mode switch never shows the old and the new layout together: the old one has left before the new one begins", async () => {
  // The browser's own transition, with the marker the app sets, to read the pseudo-elements it builds.
  document.documentElement.dataset.oneModeTransition = "test";
  const transition = document.startViewTransition(() => {});
  try {
    await transition.ready;
    const html = document.documentElement;
    const old = getComputedStyle(html, "::view-transition-old(root)");
    const arriving = getComputedStyle(html, "::view-transition-new(root)");
    expect(old.animationName).toBe("one-mode-leave");
    expect(arriving.animationName).toBe("one-mode-arrive");
    const seconds = (value: string) => Number.parseFloat(value);
    expect(seconds(arriving.animationDelay)).toBeGreaterThanOrEqual(seconds(old.animationDuration));
  } finally {
    transition.skipTransition();
    await transition.finished.catch(() => {});
    delete document.documentElement.dataset.oneModeTransition;
  }
});
