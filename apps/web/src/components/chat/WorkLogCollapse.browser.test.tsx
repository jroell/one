import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { WorkLogCollapse, WorkLogDetails } from "./WorkLog";

const open = (
  <WorkLogCollapse>
    <WorkLogDetails kind="panel">
      <p>tool output</p>
    </WorkLogDetails>
  </WorkLogCollapse>
);
const closed = <WorkLogCollapse>{null}</WorkLogCollapse>;

it("keeps a closing row's details on screen, marked closing, until its animation ends", async () => {
  await using screen = await render(open, { router: false });
  await expect.element(screen.getByText("tool output")).toBeVisible();
  await screen.rerender(closed);
  const reveal = () => screen.container.querySelector("[data-one-work-reveal]");
  expect(reveal()?.hasAttribute("data-closing")).toBe(true);
  expect(screen.container.textContent).toContain("tool output");
  await vi.waitFor(() => expect(screen.container.textContent).not.toContain("tool output"));
});

it("closes at once, with no animation, under reduced motion", async () => {
  const session = cdp();
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  try {
    await using screen = await render(open, { router: false });
    await expect.element(screen.getByText("tool output")).toBeVisible();
    await screen.rerender(closed);
    await vi.waitFor(() => expect(screen.container.textContent).not.toContain("tool output"));
    expect(screen.container.querySelector("[data-one-work-reveal]")).toBeNull();
  } finally {
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
});

it("opens by height with its content a beat behind, and closes over the exit duration", async () => {
  await using screen = await render(open, { router: false });
  const reveal = screen.container.querySelector("[data-one-work-reveal]") as HTMLElement;
  expect(getComputedStyle(reveal).animationName).toBe("one-reveal");
  const details = reveal.querySelector("[data-one-work-details]") as HTMLElement;
  expect(getComputedStyle(details).animationDelay).not.toBe("0s");
  const enter = parseFloat(getComputedStyle(reveal).animationDuration);
  await screen.rerender(closed);
  const closing = screen.container.querySelector("[data-one-work-reveal]") as HTMLElement;
  expect(getComputedStyle(closing).animationDirection).toBe("reverse");
  const exit = parseFloat(getComputedStyle(closing).animationDuration);
  expect(exit).toBeLessThan(enter);
});
