import { describe, expect, it, vi } from "vite-plus/test";

import { ToastQueue, type QueuedToastOptions, type ToastQueueEvent } from "./toast.queue";

function setup(
  overrides: { focus?: boolean; renderable?: (o: QueuedToastOptions) => boolean } = {},
) {
  const events: ToastQueueEvent[] = [];
  const state = { focus: overrides.focus ?? false, thread: "a", attached: true };
  const queue = new ToastQueue({
    deliver: (event) => events.push(event),
    isAttached: () => state.attached,
    hasFocusWithin: () => state.focus,
    isRenderable:
      overrides.renderable ??
      ((options) => {
        const scoped = (options.data as { thread?: string } | undefined)?.thread;
        return scoped === undefined || scoped === state.thread;
      }),
  });
  const added = () => events.flatMap((event) => (event.action === "add" ? [event.options] : []));
  const closed = () =>
    events.flatMap((event) => (event.action === "close" ? [event.options.id] : []));
  const add = (options: Omit<QueuedToastOptions, "id"> & { id: string }) =>
    queue.handle({ action: "add", options });
  /** What Base UI does when the shown toast finishes: it calls onClose, later onRemove. */
  const finish = async (id: string) => {
    const options = added()
      .filter((item) => item.id === id)
      .at(-1)!;
    options.onClose?.();
    await Promise.resolve();
    options.onRemove?.();
  };
  return { queue, events, state, added, closed, add, finish };
}

describe("ToastQueue", () => {
  it("shows the first toast at once and holds the next out of Base UI, so a waiting toast has no timer", () => {
    const { add, added } = setup();
    add({ id: "a", type: "info", title: "A" });
    add({ id: "b", type: "info", title: "B", timeout: 5000 });

    expect(added().map((item) => item.id)).toEqual(["a"]);
  });

  it("gives an error with an action no timeout when it is shown, and keeps a caller's timeout on an ordinary toast", () => {
    const { add, added, finish } = setup();
    add({ id: "first", type: "info", title: "First" });
    add({
      id: "retry",
      type: "error",
      title: "Failed",
      timeout: 5000,
      data: { onRetry: () => {} },
    });
    add({ id: "plain", type: "info", title: "Plain", timeout: 3000 });
    return finish("first").then(() => {
      const shown = added().find((item) => item.id === "retry")!;
      expect(shown.timeout).toBe(0);
      expect(shown.priority).toBeUndefined();
      expect(added().find((item) => item.id === "plain")).toBeUndefined();
    });
  });

  it("shows waiting errors and toasts with actions before ordinary ones, oldest first within each", async () => {
    const { add, added, finish } = setup();
    add({ id: "p", type: "info", title: "Shown", timeout: 0 });
    add({ id: "n1", type: "info", title: "n1" });
    add({ id: "e1", type: "error", title: "e1" });
    add({ id: "n2", type: "success", title: "n2" });
    add({ id: "e2", type: "info", title: "e2", actionProps: { children: "Undo" } });
    // e1 outranks the shown ordinary toast and no focus is inside it, so it goes first.
    expect(added().map((item) => item.id)).toEqual(["p", "e1"]);

    await finish("e1");
    await Promise.resolve();
    expect(added().map((item) => item.id)).toEqual(["p", "e1", "e2"]);
    await finish("e2");
    await Promise.resolve();
    expect(added().map((item) => item.id)).toEqual(["p", "e1", "e2", "p"]);
  });

  it("does not take the screen from a toast that holds focus", () => {
    const { add, added, state } = setup();
    add({ id: "ordinary", type: "info", title: "Ordinary", timeout: 0 });
    state.focus = true;
    add({ id: "error", type: "error", title: "Error" });

    expect(added().map((item) => item.id)).toEqual(["ordinary"]);
  });

  it("sends an ordinary toast back to the queue when an error takes the screen, without telling its caller it was removed", async () => {
    const onClose = vi.fn();
    const onRemove = vi.fn();
    const { add, added, finish, closed, queue } = setup();
    add({ id: "ordinary", type: "info", title: "Ordinary", timeout: 0, onClose, onRemove });
    add({ id: "error", type: "error", title: "Error" });

    expect(closed()).toEqual(["ordinary"]);
    const first = added()[0]!;
    first.onClose?.();
    first.onRemove?.();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(queue.getWaiting().map((item) => item.id)).toEqual(["ordinary"]);

    await finish("error");
    await Promise.resolve();
    expect(added().map((item) => item.id)).toEqual(["ordinary", "error", "ordinary"]);
    await finish("ordinary");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("runs onClose and onRemove for a waiting toast that is closed, and for every waiting toast when all are closed", () => {
    const calls: string[] = [];
    const { add, queue } = setup();
    const callbacks = (id: string) => ({
      onClose: () => calls.push(`${id}:close`),
      onRemove: () => calls.push(`${id}:remove`),
    });
    add({ id: "shown", type: "info", title: "Shown", timeout: 0 });
    add({ id: "w1", type: "info", title: "w1", ...callbacks("w1") });
    add({ id: "w2", type: "info", title: "w2", ...callbacks("w2") });

    queue.handle({ action: "close", options: { id: "w1" } });
    expect(calls).toEqual(["w1:close", "w1:remove"]);
    expect(queue.getWaiting().map((item) => item.id)).toEqual(["w2"]);

    queue.handle({ action: "close", options: {} });
    expect(calls).toEqual(["w1:close", "w1:remove", "w2:close", "w2:remove"]);
    expect(queue.getWaiting()).toEqual([]);
  });

  it("counts the waiting toasts, urgent first, and shows one now when it is promoted", () => {
    const { add, added, queue } = setup();
    add({ id: "shown", type: "info", title: "Shown", timeout: 0 });
    add({ id: "n", type: "info", title: "n" });
    add({ id: "e", type: "error", title: "e" });
    // e preempts: the shown ordinary toast is waiting too.
    expect(queue.getWaiting().map((item) => `${item.id}:${item.outranks}`)).toEqual([
      "shown:false",
      "n:false",
    ]);

    // The error is on screen now; promoting "n" sends it back, ahead of the ordinary toast.
    queue.promote("n");
    expect(added().at(-1)!.id).toBe("n");
    expect(queue.getWaiting().map((item) => item.id)).toEqual(["e", "shown"]);
  });

  it("holds a toast scoped to another thread until that thread is open", async () => {
    const { add, added, state, queue } = setup();
    add({ id: "here", type: "info", title: "Here", timeout: 0 });
    add({ id: "there", type: "info", title: "There", data: { thread: "b" } });
    expect(queue.getWaiting()).toEqual([]);

    state.thread = "b";
    queue.refresh();
    // "here" stays on screen; "there" waits behind it and is now counted.
    expect(queue.getWaiting().map((item) => item.id)).toEqual(["there"]);
    expect(added().map((item) => item.id)).toEqual(["here"]);
  });

  it("merges an update into a waiting toast and forwards an update to the shown one", () => {
    const { add, events, queue } = setup();
    add({ id: "shown", type: "info", title: "Shown", timeout: 0 });
    add({ id: "w", type: "info", title: "Before" });
    queue.handle({ action: "update", options: { id: "w", updates: { title: "After" } } });
    queue.handle({ action: "update", options: { id: "shown", updates: { title: "Changed" } } });

    expect(queue.getWaiting()[0]!.title).toBe("After");
    expect(events.filter((event) => event.action === "update")).toHaveLength(1);
  });

  it("shows the toast that was on screen again when a provider mounts, and keeps toasts raised before any provider", () => {
    const { add, added, state, queue } = setup();
    state.attached = false;
    add({ id: "early", type: "info", title: "Early" });
    add({ id: "later", type: "info", title: "Later" });
    expect(added()).toEqual([]);

    state.attached = true;
    queue.attach();

    expect(added().map((item) => item.id)).toEqual(["early"]);
    expect(queue.getWaiting().map((item) => item.id)).toEqual(["later"]);
  });

  it("finishes a close itself when no provider is mounted: callbacks run and the next toast takes over", () => {
    const calls: string[] = [];
    const { add, state, queue } = setup();
    const callbacks = (id: string) => ({
      onClose: () => calls.push(`${id}:close`),
      onRemove: () => calls.push(`${id}:remove`),
    });
    state.attached = false;
    add({ id: "one", type: "info", title: "One", ...callbacks("one") });
    add({ id: "two", type: "info", title: "Two", ...callbacks("two") });

    queue.handle({ action: "close", options: { id: "one" } });
    expect(calls).toEqual(["one:close", "one:remove"]);
    queue.handle({ action: "close", options: {} });
    expect(calls).toEqual(["one:close", "one:remove", "two:close", "two:remove"]);
    expect(queue.getWaiting()).toEqual([]);
  });

  it("drops what a provider showed or was sent when it unmounts, and keeps toasts raised before any provider", () => {
    const { add, added, state, queue } = setup();
    state.attached = false;
    add({ id: "early", type: "info", title: "Early" });
    state.attached = true;
    queue.attach();
    add({ id: "live-held", type: "info", title: "Held in the provider" });
    expect(added().map((item) => item.id)).toEqual(["early"]);

    state.attached = false;
    queue.detach();
    add({ id: "while-gone", type: "info", title: "Raised while no provider" });
    state.attached = true;
    queue.attach();

    expect(added().map((item) => item.id)).toEqual(["early", "while-gone"]);
    expect(queue.getWaiting()).toEqual([]);
  });

  it("folds the same message into one notice: a waiting one is replaced in place and an on-screen one stands, and the new id answers to it", () => {
    const calls: string[] = [];
    const { add, added, queue, events } = setup();
    add({ id: "shown", type: "error", title: "Could not save", description: "Disk full" });
    add({ id: "other", type: "info", title: "Other" });
    add({
      id: "other-again",
      type: "info",
      title: "Other",
      onClose: () => calls.push("again:close"),
    });
    add({ id: "dup", type: "error", title: "Could not save", description: "Disk full" });

    expect(queue.getWaiting().map((item) => item.id)).toEqual(["other"]);
    expect(added().map((item) => item.id)).toEqual(["shown"]);

    // The notice stands for both callers, so it closes when the last of them closes it.
    queue.handle({ action: "close", options: { id: "dup" } });
    expect(events.some((event) => event.action === "close")).toBe(false);
    queue.handle({ action: "close", options: { id: "shown" } });
    expect(events.at(-1)).toEqual({ action: "close", options: { id: "shown" } });
    expect(calls).toEqual([]);
    queue.handle({ action: "close", options: { id: "other-again" } });
    expect(queue.getWaiting()).toEqual([]);
    expect(calls).toEqual(["again:close"]);
  });

  it("keeps a folded notice for the caller still working when another caller closes it: the second checkout's result still shows", () => {
    const { add, closed, queue, events } = setup();
    const preparing = { type: "loading", title: "Preparing the pull request checkout..." };
    add({ id: "first-checkout", ...preparing });
    add({ id: "second-checkout", ...preparing });

    // The first checkout was superseded and closes its notice.
    queue.handle({ action: "close", options: { id: "first-checkout" } });
    expect(closed()).toEqual([]);

    queue.handle({
      action: "update",
      options: { id: "second-checkout", updates: { type: "success", title: "Checked out" } },
    });
    expect(events.at(-1)).toEqual({
      action: "update",
      options: { id: "first-checkout", updates: { type: "success", title: "Checked out" } },
    });

    queue.handle({ action: "close", options: { id: "second-checkout" } });
    expect(closed()).toEqual(["first-checkout"]);
  });
});
