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
  it("the welcome's ring never runs the rise-in its other children do, so the ring is at full opacity and in place on the frame it is swapped in", () => {
    using _clean = cleanUpOnDispose();
    mountHome();
    const orb = document.querySelector<HTMLElement>(".one-chat-welcome-orb")!;
    const heading = document.querySelector<HTMLElement>(".one-chat-welcome > h1")!;
    expect(orb.getAnimations()).toHaveLength(0);
    // The siblings do rise (the rule this one exempts the ring from still exists).
    expect(
      heading.getAnimations().map((animation) => (animation as CSSAnimation).animationName),
    ).toContain("one-rise");
  });

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
    // The swap frame: the ghost hides and the live ring shows, and the ghost is on the live box.
    await vi.waitFor(() => expect(ghost!.layer.style.visibility).toBe("hidden"), { timeout: 3000 });
    expect(orb.style.opacity).toBe("1");
    const landed = ghost!.ring.getBoundingClientRect();
    const to = orb.getBoundingClientRect();
    expect(landed.left + landed.width / 2).toBeCloseTo(to.left + to.width / 2, 0);
    expect(landed.top + landed.height / 2).toBeCloseTo(to.top + to.height / 2, 0);
    expect(landed.width).toBeCloseTo((to.width * from.width) / ghost!.from.width, 0);
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
    // Only the waiting turn runs; the flight has not started, so the ring is still where it was.
    expect(ghost.ring.style.transform).toBe(ghost.ringShown.transform);
    // The placeholder stays clear and the turns wait, so nothing behind the ring reads as loading.
    await vi.waitFor(() => {
      const opacity = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!).opacity;
      expect(opacity("[data-timeline-loading]")).toBe("0");
      expect(opacity("[data-timeline-row-id]")).toBe("0");
    });
    document.getElementById("timeline")!.setAttribute("data-first-screen-ready", "");
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    await vi.waitFor(() => expect(ghost.ring.style.transform).not.toBe(ghost.ringShown.transform));
    // Ring and wordmark travel as one lockup: the real wordmark waits hidden until it lands.
    expect(document.querySelector<HTMLElement>("[data-one-wordmark]")!.style.opacity).toBe("0");
    const nameEffect = ghost.name?.getAnimations()[0]?.effect as KeyframeEffect | undefined;
    expect(String(nameEffect?.getKeyframes().at(-1)?.transform)).toContain("scale(");
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 3000,
    });
    expect(document.querySelector<HTMLElement>("[data-one-wordmark]")!.style.opacity).toBe("");
  });

  it("the wordmark flies on the same curve as the ring, so the lockup does not split mid-flight", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    using _page = mountThreadPage();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    playBootHandoff(ghost, { holdBoundMs: 10_000 });
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("hold"));
    document.getElementById("timeline")!.setAttribute("data-first-screen-ready", "");
    const name = await vi.waitFor(() => {
      const animation = ghost.name?.getAnimations()[0];
      expect(animation).toBeDefined();
      return animation!;
    });
    const samples: Array<{ time: number; progress: number }> = [];
    await vi.waitFor(
      () => {
        const progress = name.effect?.getComputedTiming().progress;
        if (typeof progress === "number")
          samples.push({ time: Number(name.currentTime), progress });
        expect(name.playState).not.toBe("running");
      },
      { interval: 8, timeout: 3000 },
    );
    expect(samples.length).toBeGreaterThan(10);
    const early = samples.filter(({ time }) => time > 100 && time < 250);
    expect(early.length).toBeGreaterThan(0);
    for (const { time, progress } of early) {
      // The ring has covered this share of its flight at this moment.
      expect(progress).toBeCloseTo(1 - (1 - time / 560) ** 3.4, 1);
    }
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

  /** Counts the rings a person can see on each frame: the ghost's and the app's own. */
  function countRingsEachFrame(ghost: ReturnType<typeof captureBootGhost> & object) {
    const counts: number[] = [];
    const root = document.getElementById("root") ?? document.body;
    const visible = (element: Element | null) => {
      if (element === null || !element.isConnected) return false;
      const own = Number(getComputedStyle(element).opacity);
      return own * Number(getComputedStyle(root).opacity) > 0.05;
    };
    const sample = () => {
      const layer = ghost.layer;
      const ghostShows =
        layer.isConnected &&
        layer.style.visibility !== "hidden" &&
        Number(getComputedStyle(ghost.ring).opacity) > 0.05;
      const live = document.querySelector(".one-chat-welcome-orb");
      counts.push((ghostShows ? 1 : 0) + (visible(live) ? 1 : 0));
      if (!layer.isConnected) window.clearInterval(timer);
    };
    const timer = window.setInterval(sample, 8);
    return counts;
  }

  it("shows exactly one ring on every frame of the flight, never two above 5% and never none", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="root"><div class="one-chat-welcome" style="position:fixed;left:600px;top:400px">
         <div class="one-chat-welcome-orb" style="width:112px;height:112px"></div><h1>Hi</h1></div></div>`,
    );
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    const counts = countRingsEachFrame(ghost);
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 4000,
    });
    expect(counts.length).toBeGreaterThan(30);
    expect(counts.every((count) => count === 1)).toBe(true);
  });

  it("keeps one ring while the welcome is replaced mid-flight, and lands on the new one", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    const welcome = (left: number) =>
      `<div class="one-chat-welcome" style="position:fixed;left:${left}px;top:400px">
         <div class="one-chat-welcome-orb" style="width:112px;height:112px"></div></div>`;
    document.body.insertAdjacentHTML("beforeend", `<div id="root">${welcome(600)}</div>`);
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    const counts = countRingsEachFrame(ghost);
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    document.querySelector(".one-chat-welcome")!.remove();
    // The ring has no target for a while: it must still show, once.
    const lostAt = counts.length;
    await vi.waitFor(() => expect(counts.length).toBeGreaterThan(lostAt + 5));
    document.getElementById("root")!.insertAdjacentHTML("beforeend", welcome(300));
    const next = document.querySelector<HTMLElement>(".one-chat-welcome-orb")!;
    await vi.waitFor(() => expect(ghost.layer.style.visibility).toBe("hidden"), { timeout: 4000 });
    const landed = ghost.ring.getBoundingClientRect();
    const box = next.getBoundingClientRect();
    expect(landed.left + landed.width / 2).toBeCloseTo(box.left + box.width / 2, 0);
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 4000,
    });
    expect(counts.every((count) => count === 1)).toBe(true);
  });

  it("keeps the ring on screen while its target is hidden mid-flight and lands when the target is shown again", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    mountHome();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    const orb = document.querySelector<HTMLElement>(".one-chat-welcome-orb")!;
    const counts = countRingsEachFrame(ghost);
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("travel"));
    orb.style.display = "none";
    // Past the flight's length, the ring is still the one on screen and has not been swapped.
    const lostAt = counts.length;
    await vi.waitFor(() => expect(counts.length).toBeGreaterThan(lostAt + 100), { timeout: 4000 });
    expect(ghost.layer.style.visibility).not.toBe("hidden");
    expect(Number(getComputedStyle(ghost.ring).opacity)).toBeGreaterThan(0.9);
    orb.style.display = "";
    await vi.waitFor(() => expect(ghost.layer.style.visibility).toBe("hidden"), { timeout: 3000 });
    expect(orb.style.opacity).toBe("1");
  });

  it("follows a redirect from / to a thread: the ring holds, then flies to the sidebar lockup, and the app is never shown under it beside a second wordmark", async () => {
    await page.viewport(1200, 800);
    window.history.replaceState(null, "", "/");
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    playBootHandoff(ghost, { holdBoundMs: 10_000 });
    const shown: Array<string | undefined> = [];
    const watch = new MutationObserver(() =>
      shown.push(document.documentElement.dataset.oneHandoff),
    );
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-one-handoff"],
    });
    using _page = mountThreadPage();
    await vi.waitFor(() => expect(document.documentElement.dataset.oneHandoff).toBe("hold"));
    document.body.insertAdjacentHTML("beforeend", "<div data-first-screen-ready></div>");
    await vi.waitFor(() => expect(ghost.layer.style.visibility).toBe("hidden"), { timeout: 4000 });
    watch.disconnect();
    expect(shown).not.toContain("settle");
    const glyph = document.querySelector<HTMLElement>("[data-one-brand-glyph]")!;
    const landed = ghost.ring.getBoundingClientRect();
    const box = glyph.getBoundingClientRect();
    expect(landed.left + landed.width / 2).toBeCloseTo(box.left + box.width / 2, 0);
  });

  it("on home the boot title has left before the app's own wordmark shows, so two wordmarks are never visible together", async () => {
    await page.viewport(1200, 800);
    window.history.replaceState(null, "", "/");
    using _clean = cleanUpOnDispose();
    mountBootScreen();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="root"><span data-one-wordmark style="position:fixed;left:20px;top:20px">One</span>
         <div class="one-chat-welcome" style="position:fixed;left:600px;top:400px">
         <div class="one-chat-welcome-orb" style="width:112px;height:112px"></div><h1>Hi</h1></div></div>`,
    );
    const ghost = captureBootGhost()!;
    document.getElementById("boot-shell")?.remove();
    const overlaps: number[] = [];
    const seen: number[] = [];
    const timer = window.setInterval(() => {
      if (!ghost.layer.isConnected || !ghost.name) return;
      const title =
        Number(getComputedStyle(ghost.name).opacity) *
        Number(getComputedStyle(ghost.layer).opacity);
      const word = document.querySelector<HTMLElement>("[data-one-wordmark]")!;
      const own =
        Number(getComputedStyle(word).opacity) *
        Number(getComputedStyle(document.getElementById("root")!).opacity);
      seen.push(own);
      if (title > 0.05 && own > 0.05) overlaps.push(title);
    }, 8);
    playBootHandoff(ghost);
    await vi.waitFor(() => expect(document.querySelector(".boot-ghost")).toBeNull(), {
      timeout: 4000,
    });
    window.clearInterval(timer);
    expect(Math.max(...seen)).toBeGreaterThan(0.9);
    expect(overlaps).toEqual([]);
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
    // It never flew: the ring stayed where the boot left it while the ghost faded.
    expect(ghost.ring.style.transform).toBe(ghost.ringShown.transform);
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

  it("measures the boot ring by its box, not by the width it shows while turned, so the flight never scales from a sliver", async () => {
    await page.viewport(1200, 800);
    using _clean = cleanUpOnDispose();
    mountBootScreen("rotate:y 80deg");
    const ghost = captureBootGhost()!;
    expect(document.getElementById("boot-shell-ring")!.getBoundingClientRect().width).toBeLessThan(
      60,
    );
    expect(ghost.from.width).toBe(176);
    expect(ghost.from.height).toBe(176);
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
