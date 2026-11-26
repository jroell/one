import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createTaskQueue } from "./useApprovalPreview";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("runs the next live preview on the first timer turn after a hundred queued ones are cancelled", () => {
  const enqueue = createTaskQueue();
  const cancelled = Array.from({ length: 100 }, () => enqueue(vi.fn()));
  const live = vi.fn();
  enqueue(live);
  for (const cancel of cancelled) cancel();
  vi.advanceTimersToNextTimer();
  expect(live).toHaveBeenCalledOnce();
});

it("runs one task per timer turn, in order, so no two previews compute together", () => {
  const enqueue = createTaskQueue();
  const order: number[] = [];
  for (const id of [1, 2, 3]) enqueue(() => order.push(id));
  vi.advanceTimersToNextTimer();
  expect(order).toEqual([1]);
  vi.advanceTimersToNextTimer();
  expect(order).toEqual([1, 2]);
  vi.runAllTimers();
  expect(order).toEqual([1, 2, 3]);
});
