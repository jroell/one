import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "One", "one", "com.jasonroell.one"],
  ["development", "One Dev", "one-dev", "com.jasonroell.one.dev"],
  ["preview", "One Preview", "one-preview", "com.jasonroell.one.preview"],
  ["production", "One", "one", "com.jasonroell.one"],
])(
  "keeps the display name, scheme, and iOS/Android identifiers for APP_VARIANT=%j",
  async (value, name, scheme, identifier) => {
    const config = await loadConfig(value);
    expect(config.name).toBe(name);
    expect(config.scheme).toBe(scheme);
    expect(config.ios?.bundleIdentifier).toBe(identifier);
    expect(config.android?.package).toBe(identifier);
    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.android?.intentFilters).toBeUndefined();
  },
);
