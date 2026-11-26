import { describe, expect, it, vi } from "vite-plus/test";

import { installOneReflections, REFLECT_PROXIMITY_PX, REMEASURE_MS } from "./reflections";

/**
 * Installs the global listener with frames under the test's control, and builds surfaces at known
 * places: a plain one at (100, 100) 200 x 50, and one inside a working chat column.
 */
function setup({ reduceMotion = false } = {}) {
  const original = window.matchMedia.bind(window);
  const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    if (query.includes("hover: hover")) return original("all");
    if (query.includes("prefers-reduced-motion: reduce")) {
      return original(reduceMotion ? "all" : "not all");
    }
    return original(query);
  });

  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });

  const clock = { now: 5_000 };
  const now = vi.spyOn(performance, "now").mockImplementation(() => clock.now);

  const stage = document.createElement("div");
  const surface = (parent: HTMLElement, left: number, top: number) => {
    const element = document.createElement("div");
    element.dataset.oneReflect = "";
    element.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:200px;height:50px`;
    const child = document.createElement("span");
    child.textContent = "composer";
    element.append(child);
    parent.append(element);
    return {
      element,
      child,
      setProperty: vi.spyOn(element.style, "setProperty"),
      measured: vi.spyOn(element, "getBoundingClientRect"),
    };
  };
  const plain = surface(stage, 100, 100);
  const working = document.createElement("div");
  working.dataset.oneWorking = "";
  stage.append(working);
  const insideWorking = surface(working, 100, 300);
  const elsewhere = document.createElement("div");
  stage.append(elsewhere);
  document.body.append(stage);
  const uninstall = installOneReflections();

  return {
    plain,
    insideWorking,
    elsewhere,
    frameRequests: raf,
    /** Moves the test clock that the reflection reads. */
    advance: (ms: number) => {
      clock.now += ms;
    },
    /** Moves the pointer to a page position; the event targets `target`. */
    move: (target: Element, x: number, y: number, pointerType = "mouse") =>
      target.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerType }),
      ),
    /** Runs the frame callbacks that were requested. */
    flush: () => {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    },
    [Symbol.dispose]: () => {
      uninstall();
      stage.remove();
      raf.mockRestore();
      caf.mockRestore();
      media.mockRestore();
      now.mockRestore();
    },
  };
}

const writtenTo = (surface: { setProperty: { mock: { calls: unknown[][] } } }) =>
  surface.setProperty.mock.calls.map(([name, value]) => `${String(name)}=${String(value)}`);

describe("the pointer reflection on a surface", () => {
  it("writes each custom property at most once per frame however many moves arrive", () => {
    using env = setup();
    for (let step = 0; step < 20; step++) env.move(env.plain.child, 110 + step, 125);
    expect(env.frameRequests).toHaveBeenCalledTimes(1);
    expect(writtenTo(env.plain)).toEqual([]);

    env.flush();
    expect(writtenTo(env.plain)).toEqual(["--one-mx=29px", "--one-my=25px"]);
  });

  it("writes only the property whose rounded value changed", () => {
    using env = setup();
    env.move(env.plain.child, 120, 125);
    env.flush();
    env.plain.setProperty.mockClear();

    env.move(env.plain.child, 120.4, 125.2);
    env.flush();
    expect(writtenTo(env.plain)).toEqual([]);

    env.move(env.plain.child, 150, 125);
    env.flush();
    expect(writtenTo(env.plain)).toEqual(["--one-mx=50px"]);
  });

  it("reads no layout on pointer moves after the first measurement", () => {
    using env = setup();
    for (let step = 0; step < 30; step++) {
      env.move(env.plain.child, 110 + step, 120);
      env.flush();
    }
    expect(env.plain.measured).toHaveBeenCalledTimes(1);
  });

  it("measures a surface again after a scroll or a window resize", () => {
    using env = setup();
    env.move(env.plain.child, 110, 120);
    env.flush();
    expect(env.plain.measured).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("scroll"));
    env.move(env.plain.child, 111, 120);
    env.flush();
    expect(env.plain.measured).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("resize"));
    env.move(env.plain.child, 112, 120);
    env.flush();
    expect(env.plain.measured).toHaveBeenCalledTimes(3);
  });

  it("measures a surface again each time the pointer enters it", () => {
    using env = setup();
    env.move(env.plain.child, 110, 120);
    env.move(env.elsewhere, 600, 600);
    env.move(env.plain.child, 111, 120);
    env.flush();
    expect(env.plain.measured).toHaveBeenCalledTimes(2);
  });

  it("follows the pointer to the position inside a surface that moved without a scroll or resize", () => {
    using env = setup();
    env.move(env.plain.child, 120, 125);
    env.flush();
    env.plain.element.style.left = "200px";
    env.move(env.elsewhere, 600, 600);

    env.move(env.plain.child, 320, 125);
    env.flush();
    expect(writtenTo(env.plain).at(-1)).toBe("--one-mx=120px");
  });
});

describe("the pointer reflection on a surface that moves while the pointer stays inside", () => {
  it("measures it again within REMEASURE_MS and not before, so the highlight follows without a layout read on every move", () => {
    using env = setup();
    env.move(env.plain.child, 120, 125);
    env.flush();
    expect(writtenTo(env.plain).at(-1)).toBe("--one-my=25px");

    // A panel opens and shifts the composer 100px right; the pointer never leaves it.
    env.plain.element.style.left = "200px";
    env.advance(REMEASURE_MS - 1);
    env.move(env.plain.child, 320, 125);
    env.flush();
    expect(env.plain.measured).toHaveBeenCalledTimes(1);

    env.advance(1);
    env.move(env.plain.child, 321, 125);
    env.flush();
    expect(env.plain.measured).toHaveBeenCalledTimes(2);
    expect(writtenTo(env.plain).at(-1)).toBe("--one-mx=121px");
  });
});

describe("the pointer reflection while the agent works", () => {
  it("leaves a surface inside the working column alone", () => {
    using env = setup();
    for (let step = 0; step < 10; step++) env.move(env.insideWorking.child, 110 + step, 325);
    env.flush();
    expect(env.frameRequests).not.toHaveBeenCalled();
    expect(writtenTo(env.insideWorking)).toEqual([]);
    expect(env.insideWorking.measured).not.toHaveBeenCalled();
  });

  it("stops writing to a surface when its column starts working, even for a move already waiting for its frame", () => {
    using env = setup();
    env.move(env.plain.child, 120, 125);
    env.flush();
    env.plain.setProperty.mockClear();

    env.move(env.plain.child, 160, 125);
    env.plain.element.parentElement?.setAttribute("data-one-working", "");
    env.flush();
    expect(writtenTo(env.plain)).toEqual([]);

    env.move(env.plain.child, 170, 125);
    env.flush();
    expect(writtenTo(env.plain)).toEqual([]);
  });
});

describe("the pointer reflection away from a surface", () => {
  it("does nothing when the pointer is over no surface it knows", () => {
    using env = setup();
    env.move(env.elsewhere, 600, 600);
    env.flush();
    expect(env.frameRequests).not.toHaveBeenCalled();
    expect(env.plain.measured).not.toHaveBeenCalled();
  });

  it("keeps following the pointer just outside a surface it has seen, and stops further away", () => {
    using env = setup();
    env.move(env.plain.child, 110, 125);
    env.flush();
    env.plain.setProperty.mockClear();
    env.frameRequests.mockClear();

    env.move(env.elsewhere, 100 - REFLECT_PROXIMITY_PX + 4, 125);
    env.flush();
    expect(writtenTo(env.plain)).toEqual([`--one-mx=${-REFLECT_PROXIMITY_PX + 4}px`]);

    env.plain.setProperty.mockClear();
    env.frameRequests.mockClear();
    env.move(env.elsewhere, 100 - REFLECT_PROXIMITY_PX - 40, 125);
    env.flush();
    expect(env.frameRequests).not.toHaveBeenCalled();
    expect(writtenTo(env.plain)).toEqual([]);
  });

  it("ignores touch pointers", () => {
    using env = setup();
    env.move(env.plain.child, 120, 125, "touch");
    env.flush();
    expect(env.frameRequests).not.toHaveBeenCalled();
  });
});

describe("the pointer light under reduced motion", () => {
  it("writes no coordinate and asks for no frame while the user prefers reduced motion", () => {
    using env = setup({ reduceMotion: true });
    for (let step = 0; step < 10; step++) env.move(env.plain.child, 110 + step, 125);
    env.flush();
    expect(env.frameRequests).not.toHaveBeenCalled();
    expect(writtenTo(env.plain)).toEqual([]);
  });

  it("writes coordinates when reduced motion is off, for the same moves", () => {
    using env = setup();
    env.move(env.plain.child, 120, 125);
    env.flush();
    expect(writtenTo(env.plain)).toEqual(["--one-mx=20px", "--one-my=25px"]);
  });
});

describe("releasing a surface that closed", () => {
  it("stops observing a hovered surface that was removed, with no event after the removal", async () => {
    using env = setup();
    const disconnected = vi.spyOn(ResizeObserver.prototype, "disconnect");
    const released = vi.spyOn(ResizeObserver.prototype, "unobserve");
    env.move(env.plain.child, 120, 125);
    expect(disconnected).not.toHaveBeenCalled();

    env.plain.element.remove();

    // The resize observer reports the removed surface as gone; nothing else is dispatched.
    await vi.waitFor(() =>
      expect(
        disconnected.mock.calls.length > 0 ||
          released.mock.calls.some(([target]) => target === env.plain.element),
      ).toBe(true),
    );
    released.mockRestore();
    disconnected.mockRestore();
  });

  it("stops observing a removed surface when a key is pressed, before the resize observer reports", () => {
    using env = setup();
    const disconnected = vi.spyOn(ResizeObserver.prototype, "disconnect");
    env.move(env.plain.child, 120, 125);
    env.plain.element.remove();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(disconnected).toHaveBeenCalled();
    disconnected.mockRestore();
  });
});

describe("the pointer light on a gold button", () => {
  const goldButton = (parent: HTMLElement, left: number, top: number) => {
    const button = document.createElement("button");
    button.setAttribute("data-button", "");
    button.dataset.variant = "default";
    button.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:120px;height:32px`;
    parent.append(button);
    return button;
  };

  it("writes the pointer's place inside the button once per frame however many moves arrive", () => {
    using page = setup();
    const button = goldButton(page.elsewhere, 400, 100);
    const setProperty = vi.spyOn(button.style, "setProperty");

    page.move(button, 410, 110);
    page.move(button, 430, 112);
    page.move(button, 460, 120);
    expect(page.frameRequests).toHaveBeenCalledTimes(1);
    page.flush();

    expect(button.style.getPropertyValue("--one-mx")).toBe("60px");
    expect(button.style.getPropertyValue("--one-my")).toBe("20px");
    expect(setProperty).toHaveBeenCalledTimes(2);
  });

  it("keeps lighting the composer's rim while the pointer is over a gold button inside it", () => {
    using page = setup();
    const button = goldButton(page.plain.element, 20, 10);

    page.move(button, 50, 120);
    page.flush();

    expect(button.style.getPropertyValue("--one-mx")).toBe("30px");
    expect(page.plain.element.style.getPropertyValue("--one-mx")).toBe("-50px");
  });

  it("stops writing once the pointer leaves the button, and never writes to a disabled one", () => {
    using page = setup();
    const button = goldButton(page.elsewhere, 400, 100);
    const disabled = goldButton(page.elsewhere, 600, 100);
    disabled.disabled = true;

    page.move(button, 410, 110);
    page.flush();
    const calls = vi.spyOn(button.style, "setProperty");
    page.move(page.elsewhere, 900, 700);
    page.flush();
    page.move(disabled, 610, 110);
    page.flush();

    expect(calls).not.toHaveBeenCalled();
    expect(disabled.style.getPropertyValue("--one-mx")).toBe("");
  });

  it("writes nothing while the user prefers reduced motion", () => {
    using page = setup({ reduceMotion: true });
    const button = goldButton(page.elsewhere, 400, 100);

    page.move(button, 410, 110);
    page.flush();

    expect(button.style.getPropertyValue("--one-mx")).toBe("");
  });
});
