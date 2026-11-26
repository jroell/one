import { describe, expect, it } from "vite-plus/test";

import { m } from "./messages";

describe("m", () => {
  it("gives the same text for the same message and variables, and its own text for others", () => {
    const first = m("{count} files in {name}", { count: 3, name: "src" });
    expect(first).toBe("3 files in src");
    expect(m("{count} files in {name}", { count: 3, name: "src" })).toBe(first);
    expect(m("{count} files in {name}", { count: 4, name: "src" })).toBe("4 files in src");
    expect(m("{count} files in {name}", { count: 3, name: "app" })).toBe("3 files in app");
  });

  it("formats plurals by the variable's value each time", () => {
    const message = "{count, plural, one {{count} thread} other {{count} threads}}";
    expect(m(message, { count: 1 })).toBe("1 thread");
    expect(m(message, { count: 2 })).toBe("2 threads");
    expect(m(message, { count: 1 })).toBe("1 thread");
  });

  it("does not keep results for variables that are objects", () => {
    const when = new Date("2026-01-01T00:00:00Z");
    expect(() => m("{when}", { when } as never)).not.toThrow();
  });
});
