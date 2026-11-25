import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { CHAT_ARRIVAL_EXPIRY_MS, useChatArrival, type ArrivalMessage } from "./chatArrival";

const user = (id: string): ArrivalMessage => ({ id, role: "user" });
const assistant = (id: string): ArrivalMessage => ({ id, role: "assistant" });

function Probe({
  messages,
  animate,
  read,
}: {
  messages: ReadonlyArray<ArrivalMessage>;
  animate: boolean;
  read?: () => void;
}) {
  const arrival = useChatArrival(
    "thread",
    () => {
      read?.();
      return messages;
    },
    animate,
  );
  return <output data-fresh>{[...arrival.fresh].join(",")}</output>;
}

const fresh = (container: HTMLElement) =>
  container.querySelector("[data-fresh]")?.textContent ?? null;

const opening = [user("q1"), assistant("a1")];
const arrived = [...opening, user("q2"), assistant("a2")];

it("Code mode and reduced motion never read the thread's messages", async () => {
  const read = vi.fn();
  await using screen = await render(<Probe messages={opening} animate={false} read={read} />, {
    router: false,
  });
  await screen.rerender(<Probe messages={arrived} animate={false} read={read} />);
  expect(read).not.toHaveBeenCalled();
  expect(fresh(screen.container)).toBe("");
});

it("an answer that arrives while its row is not mounted stops being fresh after the expiry", async () => {
  await using screen = await render(<Probe messages={opening} animate />, { router: false });
  using _timers = fakeTimers();
  await screen.rerender(<Probe messages={arrived} animate />);
  expect(fresh(screen.container)).toBe("a2");

  await act(() => vi.advanceTimersByTime(CHAT_ARRIVAL_EXPIRY_MS - 1));
  expect(fresh(screen.container)).toBe("a2");
  await act(() => vi.advanceTimersByTime(1));
  expect(fresh(screen.container)).toBe("");
});

it("turning animation off mid-arrival drops the mark, and turning it on again does not replay it", async () => {
  await using screen = await render(<Probe messages={opening} animate />, { router: false });
  await screen.rerender(<Probe messages={arrived} animate />);
  expect(fresh(screen.container)).toBe("a2");

  await screen.rerender(<Probe messages={arrived} animate={false} />);
  expect(fresh(screen.container)).toBe("");
  await screen.rerender(<Probe messages={arrived} animate />);
  expect(fresh(screen.container)).toBe("");
});
