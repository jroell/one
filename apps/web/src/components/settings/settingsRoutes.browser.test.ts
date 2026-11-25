import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { Route } from "../../routes/_chat.settings";
import { isKnownSettingsPathname } from "./SettingsPageHeader";

async function redirectTarget(pathname: string): Promise<string | null> {
  try {
    await Route.options.beforeLoad!({ location: { pathname, hash: "" } } as never);
  } catch (error) {
    if (isRedirect(error)) return String(error.options.to);
    throw error;
  }
  return null;
}

describe("settings routes", () => {
  it("sends an address that is no settings page to General instead of an empty window", async () => {
    expect(await redirectTarget("/settings/no-such-page")).toBe("/settings/general");
    expect(await redirectTarget("/settings/chat/extra")).toBe("/settings/general");
    expect(await redirectTarget("/settings/chat")).toBeNull();
    expect(await redirectTarget("/settings/diagnostics/")).toBeNull();
  });

  it("knows every settings route file, so a new page cannot be redirected by mistake", () => {
    const retired = new Set(["beta", "integrations", "storage"]);
    const unknown = Object.keys(import.meta.glob("../../routes/_chat.settings.*.tsx"))
      .map((file) => /_chat\.settings\.(.+)\.tsx$/.exec(file)![1]!)
      .filter((name) => !retired.has(name) && !isKnownSettingsPathname(`/settings/${name}`));
    expect(unknown).toEqual([]);
  });
});
