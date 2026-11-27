import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../test/render";
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

/** The page as the app has it: a sidebar, and a chat column whose header holds the mode toggle. */
function mountPage(): Disposable & { readonly layers: readonly HTMLElement[] } {
  const sidebar = document.createElement("aside");
  sidebar.dataset.slot = "sidebar-container";
  sidebar.dataset.test = "sidebar";
  sidebar.textContent = "Threads";
  const inset = document.createElement("main");
  inset.dataset.slot = "sidebar-inset";
  inset.innerHTML =
    '<div data-chat-column="">' +
    '<header data-chat-header=""><div data-one-mode-switch="code">Code Chat</div><nav>Breadcrumb</nav></header>' +
    '<div data-test="body"><div data-slot="composer-host">Ask anything</div></div>' +
    "</div>";
  document.body.append(sidebar, inset);
  return {
    layers: [sidebar, inset],
    [Symbol.dispose]() {
      sidebar.remove();
      inset.remove();
    },
  };
}

/** Samples until `done`, each with what was visible: composers and toggles above 5% opacity. */
async function sampleFrames(done: () => boolean) {
  const effectiveOpacity = (element: Element) => {
    let value = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      value *= Number.parseFloat(getComputedStyle(node).opacity);
    }
    return value;
  };
  const visible = (selector: string) =>
    [...document.querySelectorAll(selector)].filter((element) => effectiveOpacity(element) > 0.05)
      .length;
  const frames: Array<{
    composers: number;
    toggles: number;
    sidebar: number;
    header: number;
    properties: string[];
  }> = [];
  const allowed = new Set([
    "opacity",
    "transform",
    "offset",
    "easing",
    "composite",
    "computedOffset",
  ]);
  // One sample per poll, a millisecond apart, until the switch is done.
  await vi.waitFor(
    () => {
      frames.push({
        composers: visible('[data-slot="composer-host"]'),
        toggles: visible("[data-one-mode-switch]"),
        sidebar: effectiveOpacity(document.querySelector('[data-test="sidebar"]')!),
        header: effectiveOpacity(document.querySelector("[data-chat-header]")!),
        properties: document
          .getAnimations()
          .flatMap((animation) => [
            ...(animation.effect as KeyframeEffect)
              .getKeyframes()
              .flatMap((frame) => Object.keys(frame)),
            ...((animation.effect as KeyframeEffect).pseudoElement ? ["pseudo-element"] : []),
          ])
          .filter((property) => !allowed.has(property)),
      });
      expect(done()).toBe(true);
    },
    { interval: 1, timeout: 3000 },
  );
  return frames;
}

it("a cross-fading switch changes the store and the page together, hides the conversation until it fades in, and leaves no marker", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using page = mountPage();
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
  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");
  expect(root().oneModeTransition).toBeDefined();
  // The new mode is in place, and none of it shows yet.
  const body = page.layers[1]!.querySelector<HTMLElement>('[data-test="body"]')!;
  expect(getComputedStyle(body).opacity).toBe("0");

  await vi.waitFor(() => expect(root().oneModeTransition).toBeUndefined());
  expect(getComputedStyle(body).opacity).toBe("1");
  expect(seen.every(([mode, attribute]) => mode === attribute)).toBe(true);
});

it("a mode switch never has two composers or two toggles on screen, never uses a view transition, and animates only opacity", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using _page = mountPage();
  const viewTransition = vi.spyOn(document, "startViewTransition");

  setWorkspaceMode("chat", { transition: true });
  const frames = await sampleFrames(
    () => getWorkspaceMode() === "chat" && root().oneModeTransition === undefined,
  );

  expect(frames.length).toBeGreaterThan(5);
  // The same elements throughout: at most one composer is ever visible, and the conversation does
  // go fully dark between the two layouts (a frame with none).
  expect(Math.max(...frames.map((frame) => frame.composers))).toBe(1);
  // The toggle lives in the header, which never dims, so it is visible in every frame.
  expect(Math.min(...frames.map((frame) => frame.toggles))).toBe(1);
  expect(Math.max(...frames.map((frame) => frame.toggles))).toBe(1);
  // What is the same in both modes never dims: the sidebar, the header, the toggle's own row.
  expect(Math.min(...frames.map((frame) => frame.sidebar))).toBeGreaterThanOrEqual(0.95);
  expect(Math.min(...frames.map((frame) => frame.header))).toBeGreaterThanOrEqual(0.95);
  expect(viewTransition).not.toHaveBeenCalled();
  expect(frames.flatMap((frame) => frame.properties)).toEqual([]);
  viewTransition.mockRestore();
});

it("a switch with no page layers to fade, or asked for plainly, lands at once and leaves no marker", () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();

  setWorkspaceMode("chat", { transition: true });
  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");
  expect(root().oneModeTransition).toBeUndefined();
  expect(window.localStorage.getItem("one:workspace-mode")).toBe("chat");
  setWorkspaceMode("code");
  expect(getWorkspaceMode()).toBe("code");
});

it("two quick switches end in the last mode, with the page and store agreeing and no stale marker", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using page = mountPage();

  setWorkspaceMode("chat", { transition: true });
  setWorkspaceMode("code", { transition: true });
  await vi.waitFor(() => expect(root().oneModeTransition).toBeUndefined());
  expect(getWorkspaceMode()).toBe("code");
  expect(root().oneMode).toBe("code");
  // Nothing of the switch is left holding the layers.
  for (const layer of page.layers) expect(layer.getAnimations({ subtree: true })).toEqual([]);
});

it("a plain switch lands at once, even while a cross-fade to the same mode is waiting", async () => {
  using _mode = startInCodeMode();
  using _motion = motionAllowed();
  using _page = mountPage();

  setWorkspaceMode("chat", { transition: true });
  setWorkspaceMode("chat");

  expect(getWorkspaceMode()).toBe("chat");
  expect(root().oneMode).toBe("chat");
  await vi.waitFor(() => expect(root().oneModeTransition).toBeUndefined());
  expect(getWorkspaceMode()).toBe("chat");
});
