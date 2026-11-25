import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { LimitMeter } from "./UsageMeter";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";
const now = Date.parse(checkedAt);
const WEEK_MINUTES = 7 * 24 * 60;

/** A weekly window with `usedPercent` spent and half of the week still ahead. */
function codexAccount(instanceId: string, usedPercent: number): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName: instanceId,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          kind: "weekly",
          usedPercent,
          resetsAt: new Date(now + (WEEK_MINUTES / 2) * 60_000).toISOString(),
          windowDurationMins: WEEK_MINUTES,
        },
      ],
    },
  };
}

function presentationsFor(...usedPercents: readonly number[]) {
  return new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: {
          providers: usedPercents.map((used, index) => codexAccount(`Account${index}`, used)),
        },
      },
    ],
  ]);
}

/** The glow's animation inside the stylesheet's reduced-motion media rule, as the browser parsed it. */
function reducedMotionGlowAnimation(): string | undefined {
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSMediaRule)) continue;
      if (!rule.conditionText.includes("prefers-reduced-motion: reduce")) continue;
      for (const inner of rule.cssRules) {
        if (inner instanceof CSSStyleRule && inner.selectorText === ".usage-meter-glow") {
          return inner.style.animationName;
        }
      }
    }
  }
  return undefined;
}

describe("LimitMeter", () => {
  it("exposes the remaining share, its range and a spoken value to assistive tech", async () => {
    await using screen = await render(
      <LimitMeter remaining={17} timeLeft={50} pace="ahead" color="red" label="Weekly" />,
      { router: false },
    );
    const meter = screen.getByRole("meter", { name: "Weekly" });
    await expect.element(meter).toHaveAttribute("aria-valuenow", "17");
    await expect.element(meter).toHaveAttribute("aria-valuemin", "0");
    await expect.element(meter).toHaveAttribute("aria-valuemax", "100");
    await expect.element(meter).toHaveAttribute("aria-valuetext", "17% left");
  });

  it("hatches the stretch between the fill and the marker only while spending is ahead of the window", async () => {
    await using screen = await render(
      <LimitMeter remaining={17} timeLeft={50} pace="ahead" color="red" label="Weekly" />,
      { router: false },
    );
    const gap = screen.container.querySelector<HTMLElement>(".usage-meter-gap");
    expect(gap?.style.left).toBe("17%");
    expect(gap?.style.width).toBe("33%");

    await screen.rerender(
      <LimitMeter remaining={48} timeLeft={50} pace="on" color="red" label="Weekly" />,
    );
    expect(screen.container.querySelector(".usage-meter-gap")).toBeNull();
    await screen.rerender(
      <LimitMeter remaining={63} timeLeft={30} pace="under" color="red" label="Weekly" />,
    );
    expect(screen.container.querySelector(".usage-meter-gap")).toBeNull();
  });

  it("draws the breathing glow only at 10% left or less and turns its animation off for reduced motion", async () => {
    await using screen = await render(
      <LimitMeter remaining={11} timeLeft={null} pace={null} color="red" label="Weekly" />,
      { router: false },
    );
    expect(screen.container.querySelector(".usage-meter-glow")).toBeNull();

    await screen.rerender(
      <LimitMeter remaining={10} timeLeft={null} pace={null} color="red" label="Weekly" />,
    );
    const glow = screen.container.querySelector<HTMLElement>(".usage-meter-glow");
    expect(glow).not.toBeNull();
    expect(getComputedStyle(glow!).animationName).toBe("usage-breathe");

    expect(reducedMotionGlowAnimation()).toBe("none");
  });
});

describe("UsageLimitsPooled meters", () => {
  it("marks a card low at 25% left and critical at 10% left, and keeps 26% comfortable", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(74)} now={now} />,
      { router: false },
    );
    const state = () =>
      screen.container.querySelector<HTMLElement>(".usage-limit")?.dataset["state"];
    expect(state()).toBe("comfortable");

    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(75)} now={now} />);
    expect(state()).toBe("low");
    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(90)} now={now} />);
    expect(state()).toBe("critical");
  });

  it("shows the behind-pace hatching on a card that has spent faster than the week", async () => {
    // Half the week is left, so 83% used leaves 17% against an even-pace marker at 50%.
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(83)} now={now} />,
      { router: false },
    );
    expect(screen.container.querySelector(".usage-meter-gap")).not.toBeNull();

    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(50)} now={now} />);
    expect(screen.container.querySelector(".usage-meter-gap")).toBeNull();
  });

  it("gives each account in a pool its own meter and press target", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(20, 60)} now={now} />,
      { router: false },
    );
    const meters = screen.container.querySelectorAll('[role="meter"]');
    expect([...meters].map((meter) => meter.getAttribute("aria-valuenow"))).toEqual(["80", "40"]);
    expect(screen.container.querySelectorAll("button.usage-seg-hit")).toHaveLength(2);
  });

  it("says when the pace runs the limit out before the reset, and otherwise that it is on track or has plenty", async () => {
    // Half of the 168-hour week is gone in every case, so 83% used empties 17% in 17h 12m.
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(83)} now={now} />,
      { router: false },
    );
    await expect
      .element(screen.getByText("At this pace it runs out in 17h 12m, 2d 18h before the reset."))
      .toBeVisible();

    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(50)} now={now} />);
    await expect.element(screen.getByText("On track to last until the reset.")).toBeVisible();
    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(10)} now={now} />);
    await expect.element(screen.getByText("Plenty left for this window.")).toBeVisible();
  });

  it("headlines the tightest limit with the time left, or says all limits are comfortable", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(90)} now={now} />,
      { router: false },
    );
    await expect
      .element(screen.getByText("Codex weekly is the one to watch: 10% left, 3d 12h to go."))
      .toBeVisible();
    await expect.element(screen.getByText("1 limit across 1 provider")).toBeVisible();

    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(40)} now={now} />);
    await expect.element(screen.getByText("All limits are comfortable.")).toBeVisible();
  });
});
