import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";

import type { EnvironmentUsageStatus } from "../../state/usage";

// Test fixtures: buckets, summaries and environment statuses shaped like the real ones.
export function bucket(provider: UsageProviderKind, costUsd: number, host: string): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider,
    model: `${provider}-model`,
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd,
    cacheSavingsUsd: 1,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    sourcePath: `/${host}/${provider}`,
  };
}

export function summary(
  host: string,
  providers: readonly (readonly [UsageProviderKind, number])[],
  extraBuckets: readonly UsageBucket[] = [],
): UsageSummary {
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets: [
      ...providers.map(([provider, cost]) => bucket(provider, cost, host)),
      ...extraBuckets,
    ],
    sources: providers.map(([provider]) => ({
      fingerprint: {
        hostId: host,
        provider,
        resolvedHomePath: `/${host}/${provider}`,
        volumeId: `vol-${host}`,
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 1,
  } as UsageSummary;
}

export function status(
  id: string,
  overrides: Partial<EnvironmentUsageStatus> = {},
): EnvironmentUsageStatus {
  return {
    environmentId: id as EnvironmentId,
    label: id,
    isPending: false,
    canReadDiagnostics: true,
    isConnected: true,
    error: null,
    summary: null,
    generation: "g1",
    ...overrides,
  };
}
