import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";
const now = Date.parse(checkedAt);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WEEK_MINUTES = 7 * 24 * 60;

interface WindowSpec {
  readonly id?: string;
  readonly label: string;
  readonly kind: "session" | "weekly" | "monthly";
  readonly usedPercent: number;
  readonly resetsInMs: number;
  readonly windowMins?: number;
}

function account(
  driver: string,
  instanceId: string,
  windows: readonly WindowSpec[],
  extra: { readonly zeroSpendCap?: boolean; readonly credits?: number } = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    displayName: instanceId,
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: windows.map((spec) => ({
        id: spec.id ?? spec.kind,
        label: spec.label,
        kind: spec.kind,
        usedPercent: spec.usedPercent,
        resetsAt: new Date(now + spec.resetsInMs).toISOString(),
        ...(spec.windowMins === undefined ? {} : { windowDurationMins: spec.windowMins }),
      })),
      ...(extra.zeroSpendCap ? { zeroSpendCap: true } : {}),
      ...(extra.credits ? { resetCredits: { availableCount: extra.credits } } : {}),
    },
  } as ServerProvider;
}

function presentations(
  providers: readonly ServerProvider[],
  usageLimitSources: readonly unknown[] = [],
) {
  return new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: { providers, usageLimitSources: usageLimitSources as never },
      },
    ],
  ]);
}

const session = (usedPercent: number, resetsInMs: number): WindowSpec => ({
  label: "Session",
  kind: "session",
  usedPercent,
  resetsInMs,
  windowMins: 300,
});

describe("UsageLimitsPooled with accounts on different resets", () => {
  // A Plus account about to reset beside a Pro account hours from its own reset.
  const mismatched = () =>
    presentations([
      account("codex", "Plus", [session(0, 30 * MINUTE)]),
      account("codex", "Pro", [session(80, 270 * MINUTE)]),
    ]);

  it("makes no pooled forecast sentence, since no reset belongs to the pool as a whole", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={mismatched()} now={now} />,
      {
        router: false,
      },
    );
    expect(screen.container.querySelector(".usage-limit .usage-projection")).toBeNull();
  });

  it("forecasts each account on its own clock in that account's popover", async () => {
    await using screen = await render(
      <UsageLimitsPooled presentations={mismatched()} now={now} />,
      {
        router: false,
      },
    );
    // Pro: 80% used after 30 of 300 minutes empties 20% in 7m 30s of the 270 left.
    await userEvent.hover(page.getByRole("button", { name: /^Pro: 20% left/ }));
    await expect
      .element(page.getByText(/At this pace it runs out in 7m, 4h 22m before the reset\./))
      .toBeVisible();
    void screen;
  });

  it("headlines the time to the next real refill, not the mean of the two resets", async () => {
    const providers = presentations([
      account("codex", "Plus", [session(100, 30 * MINUTE)]),
      account("codex", "Pro", [session(90, 270 * MINUTE)]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Codex session is the one to watch: 5% left, 30m to go."))
      .toBeVisible();
  });
});

describe("UsageLimitsPooled headline", () => {
  it("counts HTTP quota windows, so an exhausted quota is never 'All limits are comfortable'", async () => {
    const quota = {
      id: "acme",
      kind: "http",
      label: "Acme API",
      accounts: [],
      quotaAccounts: [
        {
          id: "key",
          label: "Key",
          windows: [
            {
              id: "month",
              label: "Monthly",
              kind: "monthly",
              usedPercent: 100,
              resetsAt: new Date(now + 3 * 24 * HOUR).toISOString(),
            },
          ],
        },
      ],
    };
    const providers = presentations(
      [account("codex", "Codex", [session(10, 150 * MINUTE)])],
      [quota],
    );
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Acme API Monthly is the one to watch: 0% left, 3d 0h to go."))
      .toBeVisible();
    await expect.element(screen.getByText("2 limits across 2 providers")).toBeVisible();
  });

  it("picks the limit that runs out soonest, not the one with the least left", async () => {
    const week = WEEK_MINUTES * MINUTE;
    const weekly = (usedPercent: number, elapsedShare: number): WindowSpec => ({
      label: "Weekly",
      kind: "weekly",
      usedPercent,
      resetsInMs: week * (1 - elapsedShare),
      windowMins: WEEK_MINUTES,
    });
    // Codex has 20% left but is spending slower than the week passes; Claude has 60% left and is
    // spending four times as fast as the week passes.
    const providers = presentations([
      account("codex", "Codex", [weekly(80, 0.9)]),
      account("claudeAgent", "Claude", [weekly(40, 0.1)]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText(/^Claude weekly is the one to watch: 60% left, /))
      .toBeVisible();
  });

  it("keeps the provider and model spelling instead of lowercasing them", async () => {
    const providers = presentations([
      account("claudeAgent", "Claude", [
        {
          id: "fable",
          label: "Weekly · Fable",
          kind: "weekly",
          usedPercent: 95,
          resetsInMs: 2 * 24 * HOUR,
          windowMins: WEEK_MINUTES,
        },
      ]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Claude weekly · Fable is the one to watch: 5% left, 2d 0h to go."))
      .toBeVisible();
  });
});

describe("UsageLimitsPooled $0 spend cap", () => {
  it("keeps the cap and its account readable in the segment caption and the legend row", async () => {
    const providers = presentations([
      account("claudeAgent", "Funded", [
        {
          id: "spend",
          label: "Monthly spend",
          kind: "monthly",
          usedPercent: 30,
          resetsInMs: 10 * 24 * HOUR,
          windowMins: 30 * 24 * 60,
        },
      ]),
      // A capped account still reports its other windows; only the monthly spend one is absent.
      account("claudeAgent", "Capped", [session(10, 150 * MINUTE)], { zeroSpendCap: true }),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    const legend = screen.container.querySelector<HTMLElement>(".usage-legend-static");
    const card = legend?.closest(".usage-limit");
    expect(card?.textContent).toContain("$0 cap");
    // Both the caption and the legend row name the capped account, in the monthly card only.
    expect(
      [...(card?.querySelectorAll(".usage-seg-name, .usage-legend-static") ?? [])].filter((node) =>
        (node.textContent ?? "").includes("Capped"),
      ),
    ).toHaveLength(2);
    // The channel is never zero-sized text: no font-size 0 hiding the label.
    expect(getComputedStyle(legend!).fontSize).not.toBe("0px");
  });
});

describe("UsageLimitsPooled card chips and labels", () => {
  const weekly = (usedPercent: number): WindowSpec => ({
    label: "Weekly",
    kind: "weekly",
    usedPercent,
    resetsInMs: 3.5 * 24 * HOUR,
    windowMins: WEEK_MINUTES,
  });

  it("says Runs out early only while spending is faster than the window, and nothing otherwise", async () => {
    await using screen = await render(
      <UsageLimitsPooled
        presentations={presentations([account("codex", "Codex", [weekly(83)])])}
        now={now}
      />,
      { router: false },
    );
    await expect.element(screen.getByText("Runs out early")).toBeVisible();

    await screen.rerender(
      <UsageLimitsPooled
        presentations={presentations([account("codex", "Codex", [weekly(40)])])}
        now={now}
      />,
    );
    await expect.element(screen.getByText("Runs out early")).not.toBeInTheDocument();
  });

  it("writes banked reset credits in words next to the reset time", async () => {
    await using screen = await render(
      <UsageLimitsPooled
        presentations={presentations([account("codex", "Codex", [weekly(40)], { credits: 2 })])}
        now={now}
      />,
      { router: false },
    );
    await expect.element(screen.getByText("2 credits")).toBeVisible();

    await screen.rerender(
      <UsageLimitsPooled
        presentations={presentations([account("codex", "Codex", [weekly(40)], { credits: 1 })])}
        now={now}
      />,
    );
    await expect.element(screen.getByText("1 credit")).toBeVisible();
  });
});

describe("UsageLimitsPooled headline ranking and labels", () => {
  const weekly = (usedPercent: number, elapsedShare: number): WindowSpec => ({
    label: "Weekly",
    kind: "weekly",
    usedPercent,
    resetsInMs: WEEK_MINUTES * MINUTE * (1 - elapsedShare),
    windowMins: WEEK_MINUTES,
  });

  it("names an empty HTTP quota with no duration ahead of a healthy limit with a forecast", async () => {
    const quota = {
      id: "acme",
      kind: "http",
      label: "Acme API",
      accounts: [],
      quotaAccounts: [
        {
          id: "key",
          label: "Key",
          windows: [
            {
              id: "month",
              label: "Monthly",
              kind: "monthly",
              usedPercent: 100,
              resetsAt: new Date(now + 3 * 24 * HOUR).toISOString(),
            },
          ],
        },
      ],
    };
    // 25% used an hour into a five-hour window forecasts three hours, yet it is not empty.
    const providers = presentations([account("codex", "Codex", [session(25, 4 * HOUR)])], [quota]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Acme API Monthly is the one to watch: 0% left, 3d 0h to go."))
      .toBeVisible();
  });

  it("names an exhausted pool that has no shared clock ahead of a forecast elsewhere", async () => {
    const providers = presentations([
      account("codex", "Plus", [session(100, 30 * MINUTE)]),
      account("codex", "Pro", [session(100, 270 * MINUTE)]),
      account("claudeAgent", "Claude", [weekly(40, 0.1)]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Codex session is the one to watch: 0% left, 30m to go."))
      .toBeVisible();
  });

  it("counts down to the next refill that restores usage, skipping a reset that restores nothing", async () => {
    // The first reset belongs to an account with nothing spent, so it refills nothing; the
    // three spent accounts reset together four and a half hours out.
    const providers = presentations([
      account("codex", "Plus", [session(0, 30 * MINUTE)]),
      account("codex", "ProA", [session(100, 270 * MINUTE)]),
      account("codex", "ProB", [session(100, 270 * MINUTE)]),
      account("codex", "ProC", [session(100, 270 * MINUTE)]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Codex session is the one to watch: 25% left, 4h 30m to go."))
      .toBeVisible();
  });

  it("recognizes Codex's built-in monthly credit limit by its identity, not as a source label", async () => {
    const providers = presentations([
      account("codex", "Codex", [
        {
          id: "individual",
          label: "Monthly credit limit",
          kind: "monthly",
          usedPercent: 95,
          resetsInMs: 10 * 24 * HOUR,
          windowMins: 30 * 24 * 60,
        },
      ]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(
        screen.getByText("Codex monthly credit limit is the one to watch: 5% left, 10d 0h to go."),
      )
      .toBeVisible();
  });
});

describe("UsageLimitsPooled $0 spend cap at both widths", () => {
  const cappedPool = () =>
    presentations([
      account("claudeAgent", "Funded", [
        {
          id: "spend",
          label: "Monthly spend",
          kind: "monthly",
          usedPercent: 30,
          resetsInMs: 10 * 24 * HOUR,
          windowMins: 30 * 24 * 60,
        },
      ]),
      account("claudeAgent", "Capped", [session(10, 150 * MINUTE)], { zeroSpendCap: true }),
    ]);

  const shown = (element: Element | null) =>
    element === null ? false : getComputedStyle(element).display !== "none";

  const rendered = async (width: number) => {
    const container = document.createElement("div");
    container.style.width = `${width}px`;
    const screen = await render(<UsageLimitsPooled presentations={cappedPool()} now={now} />, {
      router: false,
      container,
    });
    const card = screen.container.querySelector(".usage-legend-static")?.closest(".usage-limit");
    return { screen, card };
  };

  it("names the capped account in the legend row when the bar is narrow", async () => {
    const { screen, card } = await rendered(300);
    await using _screen = screen;
    expect(shown(card?.querySelector(".usage-legend-static") ?? null)).toBe(true);
    expect(card?.querySelector(".usage-legend-static")?.textContent).toContain("Capped");
    expect(shown(card?.querySelector(".usage-seg-name") ?? null)).toBe(false);
  });

  it("names the capped account and its cap in the segment caption when the bar is wide", async () => {
    const { screen, card } = await rendered(1100);
    await using _screen = screen;
    const caption = [...(card?.querySelectorAll(".usage-seg-name") ?? [])].find((node) =>
      (node.textContent ?? "").includes("Capped"),
    );
    expect(shown(caption ?? null)).toBe(true);
    expect(caption?.textContent).toContain("$0 cap");
    expect(shown(card?.querySelector(".usage-legend-static") ?? null)).toBe(false);
  });
});

describe("UsageLimitsPooled headline with raw quotas, source labels and pooled pace", () => {
  const quota = (label: string, kind: string) => ({
    id: "acme",
    kind: "http",
    label: "Acme API",
    accounts: [],
    quotaAccounts: [
      {
        id: "key",
        label: "Key",
        windows: [
          {
            id: "window",
            label,
            kind,
            usedPercent: 100,
            resetsAt: new Date(now + 3 * 24 * HOUR).toISOString(),
          },
        ],
      },
    ],
  });

  it("names an empty quota ahead of one that merely rounds to 0% left, both without a clock", async () => {
    // 99.6% used shows as 0% left but is not empty; the native pool is listed first.
    const providers = presentations(
      [
        account("codex", "Codex", [
          { label: "Session", kind: "session", usedPercent: 99.6, resetsInMs: 3 * HOUR },
        ]),
      ],
      [quota("Monthly", "monthly")],
    );
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText("Acme API Monthly is the one to watch: 0% left, 3d 0h to go."))
      .toBeVisible();
  });

  it.each([
    ["Weekly", "weekly"],
    ["Subscription", "other"],
  ])("keeps an external quota's own label %s as its source wrote it", async (label, kind) => {
    const providers = presentations([], [quota(label, kind)]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    await expect
      .element(screen.getByText(`Acme API ${label} is the one to watch: 0% left, 3d 0h to go.`))
      .toBeVisible();
  });

  it("gives a pool with no shared clock no Runs out early chip", async () => {
    // Mean use 85% against mean elapsed 70% would read as ahead of pace, yet the two accounts reset
    // two hours apart, so the card has no pooled forecast to back the words.
    const providers = presentations([
      account("codex", "Half", [session(75, 150 * MINUTE)]),
      account("codex", "Late", [session(95, 30 * MINUTE)]),
    ]);
    await using screen = await render(<UsageLimitsPooled presentations={providers} now={now} />, {
      router: false,
    });
    expect(screen.container.querySelector(".usage-limit .usage-projection")).toBeNull();
    await expect.element(screen.getByText("Runs out early")).not.toBeInTheDocument();
  });
});
