import { describe, expect, it, vi } from "vite-plus/test";

import { transitionView } from "./usageViewTransition";

describe("transitionView", () => {
  it("runs the change inside a view transition, marks the page while it plays, and clears the mark", async () => {
    const start = vi.spyOn(document, "startViewTransition");
    try {
      const seen: boolean[] = [];
      transitionView(() => seen.push("usageSwitch" in document.documentElement.dataset));
      expect(start).toHaveBeenCalledTimes(1);
      await start.mock.results[0]!.value.finished;
      expect(seen).toEqual([true]);
      expect("usageSwitch" in document.documentElement.dataset).toBe(false);
    } finally {
      start.mockRestore();
    }
  });

  it("makes the change at once, with no transition, under reduced motion", () => {
    const start = vi.spyOn(document, "startViewTransition");
    const media = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: true } as unknown as MediaQueryList);
    try {
      const update = vi.fn();
      transitionView(update);
      expect(update).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
    } finally {
      media.mockRestore();
      start.mockRestore();
    }
  });
});
