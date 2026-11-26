import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { useToastLane } from "./useComposerAnchor";

function Timeline({ active }: { readonly active: boolean }) {
  useToastLane(active, 100);
  return (
    <div
      className="messages-timeline-scroll"
      data-testid="timeline"
      style={{ boxSizing: "border-box", height: 300, overflow: "auto" }}
    >
      <div style={{ height: 1200 }}>messages</div>
    </div>
  );
}

/** A reader who asks for reduced motion gets instant scrolls, which a test can read at once. */
function reducedMotion(): Disposable {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const list = original.call(window, query);
    if (!query.includes("prefers-reduced-motion")) return list;
    return new Proxy(list, {
      get(target, key) {
        if (key === "matches") return true;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof window.matchMedia;
  return {
    [Symbol.dispose]() {
      window.matchMedia = original;
    },
  };
}

function toEnd(timeline: HTMLElement) {
  timeline.scrollTop = timeline.scrollHeight;
}

describe("a toast's lane in the thread", () => {
  it("adds the toast's height as padding below the last line and scrolls a reader at the end up by it", async () => {
    using _motion = reducedMotion();
    await using screen = await render(<Timeline active={false} />, { router: false });
    const timeline = screen.getByTestId("timeline").element() as HTMLElement;
    toEnd(timeline);
    const endBefore = timeline.scrollTop;

    await screen.rerender(<Timeline active />);

    // 100px toast + 12px gap + 8px margin
    expect(timeline.style.paddingBottom).toBe("120px");
    expect(timeline.scrollTop, "the last lines move up to clear the toast").toBe(endBefore + 120);
  });

  it("leaves a reader who is mid-thread where they are", async () => {
    using _motion = reducedMotion();
    await using screen = await render(<Timeline active={false} />, { router: false });
    const timeline = screen.getByTestId("timeline").element() as HTMLElement;
    timeline.scrollTop = 200;

    await screen.rerender(<Timeline active />);

    expect(timeline.style.paddingBottom).toBe("120px");
    expect(timeline.scrollTop).toBe(200);
  });

  it("scrolls back and then removes the padding when the toast goes", async () => {
    using _motion = reducedMotion();
    await using screen = await render(<Timeline active />, { router: false });
    const timeline = screen.getByTestId("timeline").element() as HTMLElement;
    toEnd(timeline);

    await screen.rerender(<Timeline active={false} />);

    await expect
      .poll(() => timeline.style.paddingBottom, { message: "padding is removed after the scroll" })
      .toBe("");
    expect(timeline.scrollTop + timeline.clientHeight).toBeGreaterThanOrEqual(
      timeline.scrollHeight - 4,
    );
  });
});
