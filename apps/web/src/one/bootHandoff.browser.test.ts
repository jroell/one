import { describe, expect, it, vi } from "vite-plus/test";

import { captureBootGhost, playBootHandoff } from "./bootHandoff";

function mountBootScreen() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="boot-shell"><div id="boot-shell-card" style="position:fixed;left:100px;top:100px;width:300px;height:300px">
       <div id="boot-shell-ring" style="width:176px;height:176px;margin:20px"></div>
       <span id="boot-shell-name">One</span></div></div>`,
  );
}

function mountHome() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div data-one-code-welcome style="position:fixed;left:600px;top:400px">
       <div class="one-chat-welcome-orb" style="width:112px;height:112px"></div><h1>Hi</h1></div>`,
  );
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
