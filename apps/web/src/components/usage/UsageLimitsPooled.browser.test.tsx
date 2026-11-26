import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
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
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

describe("UsageLimitsPooled next refill", () => {
  it("skips elapsed resets while waiting for refreshed account data", async () => {
    function account(instanceId: string, usedPercent: number, resetsAt: string): ServerProvider {
      return {
        ...managedChatGpt(instanceId, instanceId),
        usageLimits: {
          checkedAt,
          windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent, resetsAt }],
        },
      };
    }
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              account("Work", 20, "2026-10-25T17:00:00.000Z"),
              account("Personal", 60, "2026-10-25T18:00:00.000Z"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T17:30:00Z")} />,
    );
    await expect.element(screen.getByText("↻ +30%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("↻ +30% in 30m")).toBeVisible();

    await screen.rerender(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T18:00:00Z")} />,
    );
    await expect.element(screen.getByText(/^↻ \+\d+%$/)).not.toBeInTheDocument();
  });
});

describe("UsageLimitsPooled provider waiting on sign-in", () => {
  it("shows Antigravity as a row with a button that opens its provider page, not as an error bar", async () => {
    const antigravity: ServerProvider = {
      ...managedChatGpt("antigravity", "Antigravity"),
      driver: ProviderDriverKind.make("antigravity"),
      usageLimits: {
        checkedAt,
        windows: [],
        unavailable: {
          reason: "unsupported",
          message: "Sign in with Google to see Antigravity limits.",
        },
      },
    };
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        { entry: { target: { label: "Desk" } }, serverConfig: { providers: [antigravity] } },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
      { router: "/usage" },
    );

    await expect.element(screen.getByText("Sign in to see limits.")).toBeVisible();
    // Not a detached warning bar, and the old sentence is gone.
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).not.toContain(
      "Sign in with Google to see Antigravity limits.",
    );
    expect(document.querySelector('[data-usage-setup="antigravity"]')).not.toBeNull();

    await userEvent.click(page.getByRole("button", { name: "Sign in with Google" }));
    await vi.waitFor(() => {
      expect(screen.router!.state.location.pathname).toBe("/settings/providers");
      expect(screen.router!.state.location.search).toMatchObject({
        environmentId: "desk",
        instanceId: "antigravity",
        action: "sign-in",
      });
    });
  });
});

describe("UsageLimitsPooled notices that report a failed read", () => {
  it("offers Retry on the notice itself, as an outline button", async () => {
    const failing: ServerProvider = {
      ...managedChatGpt("codex_work", "Codex"),
      usageLimits: { checkedAt, windows: [], unavailable: { reason: "probeFailed" } },
    };
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        { entry: { target: { label: "Desk" } }, serverConfig: { providers: [failing] } },
      ],
    ]);
    const retry = vi.fn();
    await using screen = await render(
      <UsageLimitsPooled
        presentations={presentations}
        now={Date.parse(checkedAt)}
        onRetry={retry}
      />,
    );

    await expect.element(screen.getByText("Codex: Could not read limits.")).toBeVisible();
    const button = page.getByRole("button", { name: "Retry" });
    await userEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
  });
});
