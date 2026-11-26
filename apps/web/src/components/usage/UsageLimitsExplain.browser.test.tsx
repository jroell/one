import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import type { StartConversationInput } from "../settings/explain/conversation";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const state = vi.hoisted(() => ({
  start: undefined as unknown as (input: StartConversationInput) => Promise<void>,
}));

vi.mock(import("../settings/explain/conversation"), async (original) => ({
  ...(await original()),
  useConversationAvailability: () => ({ ok: true }) as const,
  useStartConversation: () => state.start,
}));

const checkedAt = "2026-10-25T16:00:00.000Z";
const antigravity = {
  instanceId: ProviderInstanceId.make("antigravity"),
  driver: ProviderDriverKind.make("antigravity"),
  displayName: "Antigravity",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt,
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt,
    windows: [],
    unavailable: { reason: "unsupported", message: "Sign in with Google to see limits." },
  },
} as unknown as ServerProvider;

const desk = (serverConfig: object) =>
  new Map([
    [EnvironmentId.make("desk"), { entry: { target: { label: "Desk" } }, serverConfig }],
  ]) as unknown as ComponentProps<typeof UsageLimitsPooled>["presentations"];

describe("What is this? on the Usage sheet", () => {
  it("explains the sign-in row and returns to Usage, not Settings", async () => {
    state.start = vi.fn().mockResolvedValue(undefined);
    await using _screen = await render(
      <UsageLimitsPooled
        presentations={desk({ providers: [antigravity] })}
        now={Date.parse(checkedAt)}
      />,
      { router: "/usage" },
    );
    await userEvent.click(page.getByRole("button", { name: "What is this?" }));
    const popup = document.querySelector<HTMLElement>('[data-explain-popup="usage-sign-in"]')!;
    expect(popup.textContent).toContain("Sign in to see limits");
    await userEvent.click(page.getByRole("button", { name: "Ask One about this" }));
    const input = vi.mocked(state.start).mock.lastCall![0];
    expect(input.returnTo).toEqual({ href: "/usage", label: "Usage" });
  });

  it("explains a usage source that reported no accounts, and only then", async () => {
    state.start = vi.fn().mockResolvedValue(undefined);
    await using _screen = await render(
      <UsageLimitsPooled
        presentations={desk({
          providers: [],
          usageLimitSources: [{ label: "Shared proxy", kind: "cliproxy", accounts: [] }],
        })}
        now={Date.parse(checkedAt)}
      />,
      { router: "/usage" },
    );
    expect(document.body.textContent).toContain("Shared proxy: No accounts reported.");
    await userEvent.click(page.getByRole("button", { name: "What is this?" }));
    expect(document.querySelector('[data-explain-popup="usage-no-accounts"]')).not.toBeNull();
  });

  it("offers no explanation when a usage source has accounts", async () => {
    await using _screen = await render(
      <UsageLimitsPooled
        presentations={desk({
          providers: [],
          usageLimitSources: [
            {
              label: "Shared proxy",
              kind: "cliproxy",
              accounts: [
                {
                  id: "acct-1",
                  driver: ProviderDriverKind.make("codex"),
                  usageLimits: {
                    checkedAt,
                    windows: [{ id: "session", kind: "session", label: "5h", usedPercent: 10 }],
                  },
                },
              ],
            },
          ],
        })}
        now={Date.parse(checkedAt)}
      />,
      { router: "/usage" },
    );
    expect(document.body.textContent).not.toContain("No accounts reported.");
    expect(page.getByRole("button", { name: "What is this?" }).query()).toBeNull();
  });
});
