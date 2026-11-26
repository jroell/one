import { describe, expect, it, vi } from "vite-plus/test";

import { pageSetBackRef } from "./pageSetBack";

const flag = () => document.documentElement.hasAttribute("data-page-set-back");

describe("the page behind a dialog", () => {
  it("is set back while a dialog backdrop is open, and released as it leaves", async () => {
    const backdrop = document.createElement("div");
    document.body.append(backdrop);
    const detach = pageSetBackRef(backdrop);
    try {
      expect(flag()).toBe(true);

      backdrop.setAttribute("data-ending-style", "");
      await vi.waitFor(() => expect(flag()).toBe(false));
    } finally {
      detach?.();
      backdrop.remove();
    }
  });

  it("stays set back until the last of two stacked dialogs has gone", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    const detachFirst = pageSetBackRef(first);
    const detachSecond = pageSetBackRef(second);
    try {
      detachFirst?.();
      expect(flag()).toBe(true);
      detachSecond?.();
      expect(flag()).toBe(false);
    } finally {
      first.remove();
      second.remove();
    }
  });
});
