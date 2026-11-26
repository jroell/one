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

  it("draws the fill matte: one flat colour with no gradient and no highlight band", async () => {
    await using screen = await render(
      <LimitMeter remaining={60} timeLeft={null} pace={null} color="red" label="Weekly" />,
      { router: false },
    );
    const fill = screen.container.querySelector<HTMLElement>(".usage-meter-fill")!;
    expect(getComputedStyle(fill).backgroundImage).toBe("none");
    expect(getComputedStyle(fill, "::after").content).toBe("none");
  });

  it("fills in the status colours with no glow: ember at 25% left or less, oxblood at 10% left or less", async () => {
    const fill = async (remaining: number) => {
      await using screen = await render(
        <LimitMeter remaining={remaining} timeLeft={null} pace={null} color="red" label="Weekly" />,
        { router: false },
      );
      expect(screen.container.querySelector(".usage-meter-glow, .usage-meter-halo")).toBeNull();
      const expected = (token: string) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${token})`;
        screen.container.append(probe);
        return getComputedStyle(probe).color;
      };
      const color = getComputedStyle(
        screen.container.querySelector<HTMLElement>(".usage-meter-fill")!,
      ).backgroundColor;
      return { color, attention: expected("--st-attention"), error: expected("--st-error") };
    };
    const low = await fill(25);
    expect(low.color).toBe(low.attention);
    const critical = await fill(10);
    expect(critical.color).toBe(critical.error);
    const plenty = await fill(26);
    expect(plenty.color).not.toBe(plenty.attention);
    expect(plenty.color).not.toBe(plenty.error);
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

  it("puts the label right after a one-digit figure, with no reserved gap", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(98)} now={now} />,
      { router: false },
    );
    const number = screen.container.querySelector<HTMLElement>(".usage-limit-number")!;
    const unit = screen.container.querySelector<HTMLElement>(".usage-limit-unit")!;
    expect(number.textContent).toBe("2%");
    const gap = unit.getBoundingClientRect().left - number.getBoundingClientRect().right;
    expect(gap).toBeLessThan(16);
  });

  it.each(["dark", "light"] as const)(
    "colours a meter by state in %s: a healthy fill is a neutral, low is amber, critical is red",
    async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        const terracotta = "rgb(205 112 82)";
        const fillOf = async (remaining: number) => {
          await using screen = await render(
            <LimitMeter
              remaining={remaining}
              timeLeft={null}
              pace={null}
              color={terracotta}
              label="Weekly"
            />,
            { router: false },
          );
          const probe = document.createElement("span");
          probe.style.color = "var(--usage-fill)";
          screen.container.querySelector(".usage-meter")!.append(probe);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(probe).color;
          context.fillRect(0, 0, 1, 1);
          const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
          return { r, g, b, spread: Math.max(r, g, b) - Math.min(r, g, b) };
        };
        const healthy = await fillOf(88);
        const low = await fillOf(20);
        const critical = await fillOf(5);
        // Healthy quota does not borrow the provider's terracotta, which is danger's colour too.
        expect(healthy.spread).toBeLessThan(45);
        expect(low.r).toBeGreaterThan(low.b + 60);
        expect(critical.r).toBeGreaterThan(critical.g + 60);
        expect(critical.r).toBeGreaterThan(critical.b + 40);
      } finally {
        document.documentElement.classList.remove("dark");
      }
    },
  );

  it("starts 'left' at the same x on every row, whatever the figure's width", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={presentationsFor(98)} now={now} />,
      { router: false },
    );
    const first = screen.container.querySelector(".usage-limit-unit")!.getBoundingClientRect().left;
    await screen.rerender(<UsageLimitsPooled presentations={presentationsFor(12)} now={now} />);
    const second = screen.container
      .querySelector(".usage-limit-unit")!
      .getBoundingClientRect().left;
    expect(Math.abs(first - second)).toBeLessThan(0.5);
  });
});
