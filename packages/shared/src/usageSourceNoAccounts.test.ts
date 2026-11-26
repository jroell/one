import type { UsageLimitSourceSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectLimitNotices,
  hasUsageSourceWithNoAccounts,
  usageSourceReportsNoAccounts,
} from "./usageLimitsCopy.ts";

const source = (fields: Record<string, unknown>) =>
  ({
    label: "Shared proxy",
    kind: "cliproxy",
    accounts: [],
    ...fields,
  }) as never as UsageLimitSourceSnapshot;

const presentations = (...sources: UsageLimitSourceSnapshot[]) =>
  new Map([
    [
      "environment-1",
      {
        entry: { target: { label: "Laptop" } },
        serverConfig: { providers: [], usageLimitSources: sources },
      },
    ],
  ]) as never;

describe("usage sources that report no accounts", () => {
  it("is true for a hub with no accounts and an HTTP source with no quota accounts", () => {
    expect(usageSourceReportsNoAccounts(source({}))).toBe(true);
    expect(usageSourceReportsNoAccounts(source({ kind: "http", quotaAccounts: [] }))).toBe(true);
  });

  it("is false when the source has accounts or failed with an error of its own", () => {
    expect(
      usageSourceReportsNoAccounts(source({ accounts: [{ usageLimits: { windows: [{}] } }] })),
    ).toBe(false);
    expect(
      usageSourceReportsNoAccounts(source({ kind: "http", quotaAccounts: [{ windows: [] }] })),
    ).toBe(false);
    expect(usageSourceReportsNoAccounts(source({ error: "connection refused" }))).toBe(false);
  });

  it("shows the notice exactly when the explanation is offered", () => {
    for (const [sources, expected] of [
      [[source({})], true],
      [[source({ accounts: [{ usageLimits: { windows: [{}] } }] })], false],
      [[source({ error: "boom" })], false],
    ] as const) {
      const shown = presentations(...sources);
      const noticeShown = collectLimitNotices(shown).some((line) =>
        line.endsWith("No accounts reported."),
      );
      expect(noticeShown).toBe(expected);
      expect(hasUsageSourceWithNoAccounts(shown)).toBe(expected);
    }
  });
});
