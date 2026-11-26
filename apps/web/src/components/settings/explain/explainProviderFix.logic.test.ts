import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chooseProviderFix } from "./explainProviderFix.logic";

const provider = (fields: Record<string, unknown>) =>
  ({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    ...fields,
  }) as unknown as ServerProvider;

describe("the fix offered when no AI provider is ready", () => {
  it("switches on an installed, signed-in provider that is off", () => {
    const off = provider({ instanceId: "claude", enabled: false });
    expect(chooseProviderFix([provider({ enabled: false, installed: false }), off])).toEqual({
      kind: "turn-on",
      provider: off,
    });
  });

  it("opens the Providers page when none is installed and signed in", () => {
    expect(chooseProviderFix([])).toEqual({ kind: "open-providers" });
    expect(
      chooseProviderFix([provider({ enabled: false, auth: { status: "unauthenticated" } })]),
    ).toEqual({ kind: "open-providers" });
  });

  it("offers nothing when a provider is ready, because the reason is then something else", () => {
    expect(
      chooseProviderFix([provider({}), provider({ instanceId: "x", enabled: false })]),
    ).toEqual({
      kind: "none",
    });
  });
});
