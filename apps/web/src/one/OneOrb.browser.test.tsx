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
