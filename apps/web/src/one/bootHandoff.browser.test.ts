import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { captureBootGhost, playBootHandoff } from "./bootHandoff";

function mountBootScreen(ringStyle = "") {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="boot-shell"><div id="boot-shell-card" style="position:fixed;left:100px;top:100px;width:300px;height:300px">
       <div id="boot-shell-ring" style="width:176px;height:176px;margin:20px;${ringStyle}"></div>
       <span id="boot-shell-name">One</span></div></div>`,
  );
}

function mountHome(attributes = "data-one-code-welcome") {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="one-chat-welcome" ${attributes} style="position:fixed;left:600px;top:400px">
       <div class="one-chat-welcome-orb" style="width:112px;height:112px"></div><h1>Hi</h1></div>`,
  );
}

/** A thread route with its sidebar lockup, a timeline still waiting for its first screen and the loading placeholder. */
function mountThreadPage(): Disposable {
  const before = window.location.pathname;
  window.history.replaceState(null, "", "/environment/thread");
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div data-slot="sidebar" style="position:fixed;left:0;top:0">
       <span data-one-brand-glyph style="display:inline-block;width:16px;height:16px"></span>
       <span data-one-wordmark>One</span></div>
     <div data-timeline-loading style="position:fixed;left:300px;top:300px">Loading messages</div>
     <div id="timeline" data-assistant-citation-viewport style="position:fixed;left:300px;top:100px">
       <div data-timeline-row-id="r1">First turn</div><div data-timeline-row-id="r2">Second turn</div></div>`,
  );
  return {
    [Symbol.dispose]: () => window.history.replaceState(null, "", before),
  };
}

function cleanUpOnDispose() {
  return {
    [Symbol.dispose]() {
      document.body.replaceChildren();
      delete document.documentElement.dataset.oneHandoff;
      delete document.documentElement.dataset.oneOpening;
    },
  };
}

describe("src/one/bootHandoff.ts", () => {
  it("the boot ring lands on the home ring, which stays hidden until it lands, and everything is cleaned up within 3 seconds", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    const ghost = captureBootGhost();
    expect(ghost).not.toBeNull();
    const from = ghost!.from;
    document.getElementById("boot-shell")?.remove();
    mountHome();
    const orb = document.querySelector<HTMLElement>(".one-chat-welcome-orb")!;
    playBootHandoff(ghost!);

    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    expect(orb.style.opacity).toBe("0");
    const frames = (ghost!.ring.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes();
    const [dx, dy, scale] = String(frames.at(-1)?.transform)
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    const to = orb.getBoundingClientRect();
    expect(dx).toBeCloseTo(to.left + to.width / 2 - (from.left + from.width / 2), 1);
    expect(dy).toBeCloseTo(to.top + to.height / 2 - (from.top + from.height / 2), 1);
    expect(scale).toBeCloseTo(to.width / from.width, 3);

    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(orb.style.opacity).toBe("");
    expect(document.documentElement.dataset.oneHandoff).toBeUndefined();
  });

  it("on a thread the ring holds at the centre until the first screen is ready, with no loading text under it, then flies with the wordmark", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    using _page = mountThreadPage();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    playBootHandoff(ghost, { holdBoundMs: 10_000 });
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("hold"));
    // Only the waiting turn runs; the flight has not started.
    const flights = (element: HTMLElement) =>
      element.getAnimations().filter((animation) => animation.effect?.getTiming().duration === 560);
    expect(flights(ghost.ring)).toHaveLength(0);
    // The placeholder stays clear and the turns wait, so nothing behind the ring reads as loading.
    await vi.waitFor(() => {
      const opacity = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!).opacity;
      expect(opacity("[data-timeline-loading]")).toBe("0");
      expect(opacity("[data-timeline-row-id]")).toBe("0");
    });
    document.getElementById("timeline")!.setAttribute("data-first-screen-ready", "");
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    expect(flights(ghost.ring)).toHaveLength(1);
    // Ring and wordmark travel as one lockup: the real wordmark waits hidden until it lands.
    expect(document.querySelector<HTMLElement>("[data-one-wordmark]")!.style.opacity).toBe("0");
    const nameEffect = ghost.name?.getAnimations()[0]?.effect as KeyframeEffect | undefined;
    expect(String(nameEffect?.getKeyframes().at(-1)?.transform)).toContain("scale(");
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(document.querySelector<HTMLElement>("[data-one-wordmark]")!.style.opacity).toBe("");
  });

  it("a thread that never reports its first screen releases the ring at the bound and still lands", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    using _page = mountThreadPage();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    playBootHandoff(ghost, { holdBoundMs: 250 });
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("hold"));
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"), {
      timeout: 2000,
    });
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(document.documentElement.dataset.oneHandoff).toBeUndefined();
  });

  it("without Element.checkVisibility the ring still flies and the app shows promptly", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    const original = Element.prototype.checkVisibility;
    // Safari before 17.4 has no checkVisibility.
    Object.defineProperty(Element.prototype, "checkVisibility", {
      value: undefined,
      configurable: true,
    });
    using _restore = {
      [Symbol.dispose]: () =>
        Object.defineProperty(Element.prototype, "checkVisibility", {
          value: original,
          configurable: true,
        }),
    };
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    mountHome();
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(document.documentElement.dataset.oneHandoff).toBeUndefined();
  });

  it("anything that throws inside the handoff lets the app show at once, not after 20 seconds", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    mountHome();
    const measure = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.classList.contains("one-chat-welcome-orb")) throw new Error("cannot measure");
        return new DOMRect(0, 0, 10, 10);
      });
    using _restore = { [Symbol.dispose]: () => measure.mockRestore() };
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 1500,
    });
    expect(document.documentElement.dataset.oneHandoff).toBeUndefined();
  });

  it("keeps the ghost ring turning while it holds for a thread, so the wait does not look frozen", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    using _page = mountThreadPage();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    playBootHandoff(ghost, { holdBoundMs: 10_000 });
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("hold"));
    const first = getComputedStyle(ghost.ring).rotate;
    await vi.waitFor(() => expect(getComputedStyle(ghost.ring).rotate).not.toBe(first));
    expect(
      ghost.ring
        .getAnimations()
        .some((animation) => animation.effect?.getTiming().iterations === Infinity),
    ).toBe(true);
  });

  it("on a phone the ring is not flown to the header lockup, which is not drawn there, and the ghost fades", async () => {
    await page.viewport(390, 844);
    using _clean = cleanUpOnDispose();
    using _page = mountThreadPage();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    playBootHandoff(ghost, { holdBoundMs: 100 });
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(
      ghost.ring
        .getAnimations()
        .every((animation) => animation.effect?.getTiming().duration !== 560),
    ).toBe(true);
  });

  it("lands on the welcome ring in chat mode too, whose welcome has no code attribute", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    mountHome("data-compact");
    const orb = document.querySelector<HTMLElement>(".one-chat-welcome-orb")!;
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    expect(orb.style.opacity).toBe("0");
  });

  it("hands off the ring as faded as the boot screen had it, so a fast boot flashes nothing", () => {
    using _clean = cleanUpOnDispose();
    mountBootScreen("opacity:0.25");
    const ghost = captureBootGhost()!;
    expect(ghost.ring.style.opacity).toBe("0.25");
    expect(ghost.ringShown.opacity).toBe("0.25");
  });

  it("with reduced motion the boot screen only fades out, and the ring never travels", async () => {
    using _clean = cleanUpOnDispose();
    const media = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(
        (query) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
      );
    using _restore = { [Symbol.dispose]: () => media.mockRestore() };
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    mountHome();
    playBootHandoff(ghost);

    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("fade"));
    expect(ghost.ring.getAnimations()).toHaveLength(0);
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(document.documentElement.dataset.oneHandoff).toBeUndefined();
  });

  it("nothing is handed off while the opening plays or when the boot screen shows an error", () => {
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    document.documentElement.dataset.oneOpening = "";
    expect(captureBootGhost()).toBeNull();
    delete document.documentElement.dataset.oneOpening;
    document
      .getElementById("boot-shell")
      ?.insertAdjacentHTML("beforeend", '<p id="boot-error">x</p>');
    expect(captureBootGhost()).toBeNull();
  });
});
