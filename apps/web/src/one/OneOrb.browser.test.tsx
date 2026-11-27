import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { act, render } from "../../test/render";
import { OneOrb } from "./OneOrb";

/** A WebGL context whose calls do nothing, so the ring starts without a GPU. */
function fakeGl() {
  const calls = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "isContextLost") return () => false;
        let call = calls.get(key);
        if (!call) {
          call = vi.fn(() => ({}));
          calls.set(key, call);
        }
        return call;
      },
    },
  );
}

/** Makes every canvas answer a request for a WebGL context with `webgl`. */
function answerWebglWith(webgl: unknown): Disposable {
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    ...args: unknown[]
  ) {
    return args[0] === "webgl"
      ? webgl
      : (realGetContext as (...a: unknown[]) => unknown).apply(this, args);
  } as never);
  return { [Symbol.dispose]: () => spy.mockRestore() };
}

it("the ring keeps its canvas under the flat mark while the GPU context is lost and shows the ring again after the restore", async () => {
  using _webgl = answerWebglWith(fakeGl());
  await using screen = await render(<OneOrb className="size-40" />, { router: false });
  const canvas = screen.container.querySelector("canvas");
  if (!canvas) throw new Error("the ring has no canvas");
  expect(screen.container.querySelector("[data-one-mark]")).toBeNull();

  await act(() => {
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  });
  expect(screen.container.querySelector("canvas")).toBe(canvas);
  expect(canvas.isConnected).toBe(true);
  expect(getComputedStyle(canvas).visibility).toBe("hidden");
  expect(screen.container.querySelector("[data-one-mark]")).not.toBeNull();

  await act(() => {
    canvas.dispatchEvent(new Event("webglcontextrestored"));
  });
  expect(screen.container.querySelector("canvas")).toBe(canvas);
  expect(getComputedStyle(canvas).visibility).toBe("visible");
  expect(screen.container.querySelector("[data-one-mark]")).toBeNull();
});

it("the ring shows the flat mark for good when WebGL is not available", async () => {
  using _none = answerWebglWith(null);
  await using screen = await render(<OneOrb className="size-40" />, { router: false });

  expect(screen.container.querySelector("[data-one-mark]")).not.toBeNull();
});

it("the ring's halo is sized from the ring's drawn width and, in light, is a grounded shadow instead of a glow", async () => {
  using _webgl = answerWebglWith(fakeGl());
  await using screen = await render(<OneOrb halo className="w-28" />, { router: false });
  const ring = screen.container.querySelector<HTMLElement>("[data-one-orb]")!;

  await vi.waitFor(() => expect(ring.style.getPropertyValue("--ring-size")).toBe("112px"));
  // The filter eases in, so each theme is read once it has settled.
  document.documentElement.classList.add("dark");
  await vi.waitFor(() =>
    expect(getComputedStyle(ring).filter.match(/drop-shadow/g)).toHaveLength(1),
  );
  // 112px × 0.0909 = 10.2px of glow on dark.
  expect(getComputedStyle(ring).filter).toMatch(/10\.1\d*px/);
  document.documentElement.classList.remove("dark");
  // On cream: a hairline plus a lower, tighter shadow, never the 10px glow.
  // On cream: a hairline plus a lower, tighter shadow, never the 10px glow.
  await vi.waitFor(() => {
    const light = getComputedStyle(ring).filter;
    expect(light.match(/drop-shadow/g)).toHaveLength(2);
    expect(light).not.toMatch(/0px 0px 10\.1/);
  });
});

it("a ring without the halo prop casts none, so the opening and the voice stage light themselves", async () => {
  using _webgl = answerWebglWith(fakeGl());
  await using screen = await render(<OneOrb className="w-28" />, { router: false });
  const ring = screen.container.querySelector<HTMLElement>("[data-one-orb]")!;
  expect(getComputedStyle(ring).filter).toBe("none");
});
