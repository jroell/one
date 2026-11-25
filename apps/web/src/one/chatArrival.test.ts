import { describe, expect, it } from "vite-plus/test";

import { advanceArrivals, type ArrivalMessage, type ArrivalState } from "./chatArrival";

const user = (id: string): ArrivalMessage => ({ id, role: "user" });
const assistant = (id: string): ArrivalMessage => ({ id, role: "assistant" });

function arrived(state: ArrivalState) {
  return [...state.fresh];
}

describe("advanceArrivals", () => {
  const onScreen = advanceArrivals(null, "thread-a", [user("q1"), assistant("a1")], true);

  it("marks nothing on the first paint of a thread", () => {
    expect(arrived(onScreen)).toEqual([]);
  });

  it("marks an assistant answer that arrives after the last message on screen, not the user message", () => {
    const next = advanceArrivals(
      onScreen,
      "thread-a",
      [user("q1"), assistant("a1"), user("q2"), assistant("a2")],
      true,
    );
    expect(arrived(next)).toEqual(["a2"]);
  });

  it("keeps one mark while an answer streams in and returns the same state when nothing changed", () => {
    const first = advanceArrivals(onScreen, "thread-a", [...onScreenIds(), assistant("a2")], true);
    const again = advanceArrivals(first, "thread-a", [...onScreenIds(), assistant("a2")], true);
    expect(arrived(again)).toEqual(["a2"]);
    expect(again).toBe(first);
  });

  it("marks nothing for earlier history that loads above the thread", () => {
    const next = advanceArrivals(
      onScreen,
      "thread-a",
      [user("q0"), assistant("a0"), user("q1"), assistant("a1")],
      true,
    );
    expect(arrived(next)).toEqual([]);
  });

  it("marks nothing when another thread opens, even with the same message count", () => {
    const next = advanceArrivals(onScreen, "thread-b", [user("x1"), assistant("x2")], true);
    expect(arrived(next)).toEqual([]);
    expect(next.identity).toBe("thread-b");
  });

  it("marks nothing when the animation is off, and does not replay the answer once it is on again", () => {
    const quiet = advanceArrivals(
      onScreen,
      "thread-a",
      [...onScreenIds(), user("q2"), assistant("a2")],
      false,
    );
    expect(arrived(quiet)).toEqual([]);
    const later = advanceArrivals(
      quiet,
      "thread-a",
      [...onScreenIds(), user("q2"), assistant("a2")],
      true,
    );
    expect(arrived(later)).toEqual([]);
  });

  it("treats the first messages of a thread that was empty as its first paint", () => {
    const empty = advanceArrivals(null, "thread-a", [], true);
    expect(advanceArrivals(empty, "thread-a", [], true)).toBe(empty);
    expect(
      arrived(advanceArrivals(empty, "thread-a", [user("q1"), assistant("a1")], true)),
    ).toEqual([]);
  });
});

function onScreenIds() {
  return [user("q1"), assistant("a1")];
}
