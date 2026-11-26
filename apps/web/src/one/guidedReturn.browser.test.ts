import { describe, expect, it } from "vite-plus/test";

import {
  guidedTopicThread,
  isSafeReturnHref,
  rememberGuidedReturn,
  rememberGuidedTopic,
} from "./guidedReturn";

/** Whatever a test remembered about a way back is gone when the test ends. */
function freshReturns(): Disposable {
  const clear = () => window.sessionStorage.removeItem("one:guided-return");
  clear();
  return { [Symbol.dispose]: clear };
}

describe("isSafeReturnHref", () => {
  it("accepts a path inside the app and refuses every other kind of address", () => {
    for (const href of ["/settings/providers", "/settings/providers?topic=model#top", "/"]) {
      expect(isSafeReturnHref(href), href).toBe(true);
    }
    for (const href of [
      "https://example.com/settings",
      "//example.com/settings",
      "/\\example.com",
      "javascript:alert(1)",
      "settings/providers",
      "/settings providers",
      "",
    ]) {
      expect(isSafeReturnHref(href), href).toBe(false);
    }
  });
});

describe("rememberGuidedReturn", () => {
  const stored = () => window.sessionStorage.getItem("one:guided-return");

  it("keeps a return for its thread and cuts a long label", () => {
    using _returns = freshReturns();
    expect(rememberGuidedReturn("env:thread", { label: "x".repeat(200), href: "/settings" })).toBe(
      true,
    );
    expect(JSON.parse(stored()!)["env:thread"].label).toHaveLength(80);
  });

  it("refuses an address outside the app and stores nothing for it", () => {
    using _returns = freshReturns();
    expect(rememberGuidedReturn("env:thread", { label: "Evil", href: "https://example.com" })).toBe(
      false,
    );
    expect(stored()).toBeNull();
  });
});

describe("guided topics", () => {
  it("remember the thread of a topic for the session, and know nothing of another topic", () => {
    const clear = () => window.sessionStorage.removeItem("one:guided-topics");
    clear();
    try {
      expect(guidedTopicThread("usage-providers")).toBeNull();
      rememberGuidedTopic("usage-providers", "env:thread-1");
      rememberGuidedTopic("guest-links", "env:thread-2");
      rememberGuidedTopic("usage-providers", "env:thread-3");
      expect(guidedTopicThread("usage-providers")).toBe("env:thread-3");
      expect(guidedTopicThread("guest-links")).toBe("env:thread-2");
      expect(guidedTopicThread("other")).toBeNull();
    } finally {
      clear();
    }
  });
});
