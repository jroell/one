import "~/index.css";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { WorkLogCollapse, WorkLogDetails, WorkLogRow } from "./WorkLog";

const open = (
  <WorkLogCollapse>
    <WorkLogDetails kind="panel">
      <p>tool output</p>
    </WorkLogDetails>
  </WorkLogCollapse>
);
const closed = <WorkLogCollapse>{null}</WorkLogCollapse>;

const inList = (row: ReactNode) => (
  <div style={{ position: "relative", height: 400 }}>
    <div style={{ position: "absolute", top: 0, width: "100%" }}>
      <WorkLogRow icon={null} label="Ran a command">
        {row}
      </WorkLogRow>
    </div>
    <div data-testid="below" style={{ position: "absolute", top: 200, width: "100%" }}>
      next row
    </div>
  </div>
);

it("keeps a closing row's details on screen, marked closing, until its animation ends", async () => {
  await using screen = await render(inList(open), { router: false });
  await expect.element(screen.getByText("tool output")).toBeVisible();
  await screen.rerender(inList(closed));
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

it("closes over the shorter exit duration than the open", async () => {
  await using screen = await render(inList(open), { router: false });
  const reveal = () => screen.container.querySelector("[data-one-work-reveal]") as HTMLElement;
  const duration = () => Number(reveal().getAnimations()[0]?.effect?.getTiming().duration);
  await screen.rerender(inList(closed));
  await vi.waitFor(() => expect(duration()).toBeGreaterThan(0));
  const exit = duration();
  await vi.waitFor(() => expect(screen.container.textContent).not.toContain("tool output"));
  await screen.rerender(inList(open));
  await vi.waitFor(() => expect(duration()).toBeGreaterThan(0));
  expect(exit).toBeLessThan(duration());
});

it("keeps a row's details clipped through a second close that starts while an interrupted close plays back", async () => {
  await using screen = await render(inList(open), { router: false });
  const reveal = () => screen.container.querySelector("[data-one-work-reveal]") as HTMLElement;
  const below = screen.container.querySelector("[data-testid=below]") as HTMLElement;
  await screen.rerender(inList(closed));
  await vi.waitFor(() => expect(reveal().getAnimations().length).toBeGreaterThan(0));
  await screen.rerender(inList(open));
  const playingBack = [...reveal().getAnimations(), ...below.getAnimations()];
  await screen.rerender(inList(closed));
  expect(reveal().style.overflow).toBe("hidden");

  await Promise.allSettled(playingBack.map((animation) => animation.finished));
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  expect(reveal().getAnimations().length).toBeGreaterThan(0);
  expect(reveal().style.overflow).toBe("hidden");
});

it("keeps a row's details in view when it is opened again during its close, and leaves nothing held after", async () => {
  await using screen = await render(inList(open), { router: false });
  const reveal = () => screen.container.querySelector("[data-one-work-reveal]") as HTMLElement;
  const below = screen.container.querySelector("[data-testid=below]") as HTMLElement;
  await screen.rerender(inList(closed));
  await vi.waitFor(() => expect(below.getAnimations().length).toBeGreaterThan(0));
  await screen.rerender(inList(open));
  expect(reveal().hasAttribute("data-one-armed")).toBe(false);
  await vi.waitFor(() => {
    expect(below.getAnimations()).toHaveLength(0);
    expect(reveal().getAnimations()).toHaveLength(0);
  });
  expect(reveal().style.overflow).toBe("");
  expect(getComputedStyle(below).transform).toBe("none");
  await expect.element(screen.getByText("tool output")).toBeVisible();
});
