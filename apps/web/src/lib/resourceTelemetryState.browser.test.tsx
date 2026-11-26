import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  type ResourceTelemetryHistory,
  type ResourceTelemetrySnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../test/render";

const monitor = vi.hoisted(() => ({
  telemetry:
    vi.fn<
      (args: {
        environmentId: EnvironmentId;
      }) => Atom.Atom<AsyncResult.AsyncResult<ResourceTelemetrySnapshot, MonitorError>>
    >(),
  history:
    vi.fn<
      (args: {
        environmentId: EnvironmentId;
        input: { windowMs: number; bucketMs: number };
      }) => Atom.Atom<AsyncResult.AsyncResult<ResourceTelemetryHistory, MonitorError>>
    >(),
  retry: vi.fn(),
}));

vi.mock("../components/settings/settingsLayout", () => ({
  SettingsSection: ({
    title,
    headerAction,
    children,
  }: {
    title: string;
    headerAction?: ReactNode;
    children: ReactNode;
  }) => (
    <section aria-label={title}>
      {headerAction}
      {children}
    </section>
  ),
}));

vi.mock("../state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("../state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("../state/server", () => ({
  serverEnvironment: {
    resourceTelemetry: monitor.telemetry,
    resourceTelemetryHistory: monitor.history,
  },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => monitor.retry }));

import { ResourceTelemetryDiagnostics } from "../components/settings/ResourceTelemetryDiagnostics";

class MonitorError extends Schema.TaggedError<MonitorError>()("MonitorError", {
  message: Schema.String,
}) {}

const environmentId = EnvironmentId.make("remote");
const startError = "The resource monitor is not available.";
const historyError = "Resource history could not start.";

function setup({ retryFails = false, holdRetry = false } = {}) {
  const readAt = DateTime.makeUnsafe(0);
  const aggregate = {
    processCount: 0,
    currentCpuPercent: 0,
    cpuTimeMs: 0,
    currentRssBytes: 0,
    peakRssBytes: 0,
    ioReadBytes: 0,
    ioWriteBytes: 0,
    ioReadBytesPerSecond: 0,
    ioWriteBytesPerSecond: 0,
    processStarts: 0,
    processExits: 0,
  };
  const source = {
    status: "healthy" as const,
    lastSampleAt: Option.some(readAt),
    lastError: Option.none<string>(),
  };
  const snapshot: ResourceTelemetrySnapshot = {
    readAt,
    sampleIntervalMs: 1000,
    processes: [],
    groups: { backend: aggregate, electron: aggregate, monitor: aggregate, allT3: aggregate },
    power: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: false,
      updatedAt: readAt,
    },
    speedLimitPercent: Option.none(),
    attribution: { readAt, entries: [] },
    health: {
      native: source,
      desktop: source,
      sidecarVersion: Option.none(),
      sidecarPid: Option.none(),
      restartCount: 1,
      collectionDurationMicros: 0,
      scannedProcessCount: 0,
      retainedProcessCount: 0,
      inaccessibleProcessCount: 0,
    },
  };
  const history: ResourceTelemetryHistory = {
    readAt,
    windowMs: 900000,
    bucketMs: 30000,
    sampleIntervalMs: 1000,
    retainedSampleCount: 0,
    buckets: [],
    topProcesses: [],
    health: snapshot.health,
  };
  let running = false;
  const telemetryQueries = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(
      Effect.suspend(() =>
        running ? Effect.succeed(snapshot) : Effect.fail(new MonitorError({ message: startError })),
      ),
    ).pipe(Atom.keepAlive),
  );
  monitor.telemetry.mockReset();
  monitor.telemetry.mockImplementation(({ environmentId }) => telemetryQueries(environmentId));
  const historyReads = vi.fn<(key: string) => void>();
  const historyQueries = Atom.family((key: string) =>
    Atom.make(
      Effect.suspend(() => {
        historyReads(key);
        return running
          ? Effect.succeed(history)
          : Effect.fail(new MonitorError({ message: historyError }));
      }),
    ).pipe(Atom.keepAlive),
  );
  monitor.history.mockReset();
  monitor.history.mockImplementation(({ environmentId, input }) =>
    historyQueries(`${environmentId}:${input.windowMs}`),
  );
  let releaseRetry = () => {};
  const retryRelease = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  monitor.retry.mockReset();
  monitor.retry.mockImplementation(async () => {
    if (holdRetry) await retryRelease;
    if (retryFails)
      return AsyncResult.failure(Cause.fail(new MonitorError({ message: "Restart failed." })));
    running = true;
    return AsyncResult.success({ accepted: true, snapshot });
  });
  const registry = AtomRegistry.make();
  return {
    registry,
    snapshot,
    historyQueries,
    historyReads,
    releaseRetry,
    [Symbol.dispose]: () => registry.dispose(),
  };
}

describe("resource monitor retry", () => {
  it("clears the settings and history errors after a successful retry without remounting", async () => {
    using fixture = setup();
    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
    );
    await expect.element(screen.getByText(startError, { exact: true })).toBeVisible();
    await expect.element(screen.getByText(historyError, { exact: true })).toBeVisible();

    await screen.getByRole("button", { name: "Retry monitor" }).click();

    await expect.element(screen.getByText(startError, { exact: true })).not.toBeInTheDocument();
    await expect.element(screen.getByText(historyError, { exact: true })).not.toBeInTheDocument();
    // A healthy source reads as the shared Ready chip.
    await expect
      .element(
        screen
          .getByRole("region", { name: "Resource monitor" })
          .getByText("Ready", { exact: true }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Retry monitor" }))
      .not.toBeInTheDocument();
  });

  it("says a source the browser cannot reach is Desktop only, as the shared chip, and a healthy one is Ready", async () => {
    using fixture = setup();
    Object.assign(fixture.snapshot.health, {
      desktop: {
        status: "unavailable",
        lastSampleAt: Option.none(),
        lastError: Option.some("The desktop source is not available in 'web' mode."),
      },
    });
    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
    );
    await screen.getByRole("button", { name: "Retry monitor" }).click();

    const chips = () =>
      [...screen.container.querySelectorAll("[data-settings-status]")].map((chip) => [
        chip.getAttribute("data-settings-status"),
        chip.textContent,
      ]);
    await vi.waitFor(() => expect(chips()).toContainEqual(["desktopOnly", "Desktop only"]));
    expect(chips()).toContainEqual(["ready", "Ready"]);
    expect(screen.container.textContent).not.toContain("unavailable");
  });

  it("shows a throughput figure whole in a 340 px page, wrapping instead of ending in an ellipsis", async () => {
    using fixture = setup();
    Object.assign(fixture.snapshot.groups.allT3, {
      ioReadBytesPerSecond: 117_000_000,
      ioReadBytes: 5_000,
    });
    const narrow = document.createElement("div");
    narrow.style.width = "340px";
    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
      { container: narrow },
    );
    await screen.getByRole("button", { name: "Retry monitor" }).click();

    const value = await vi.waitFor(() => {
      const found = [...screen.container.querySelectorAll<HTMLElement>("div")].find(
        (candidate) =>
          candidate.childElementCount === 0 && /MB\/s$/.test(candidate.textContent ?? ""),
      );
      expect(found).toBeDefined();
      return found!;
    });
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
    expect(getComputedStyle(value).textOverflow).not.toBe("ellipsis");
  });

  it("reads CPU in cores, draws no meter in the group cells, and shows no speed-limit figure when the host reports none", async () => {
    using fixture = setup();
    const idle = fixture.snapshot.groups.monitor;
    Object.assign(fixture.snapshot.groups, {
      allT3: { ...idle, currentCpuPercent: 194.1, currentRssBytes: 1000 },
      backend: { ...idle, currentRssBytes: 300 },
      electron: { ...idle, currentRssBytes: 700 },
      monitor: { ...idle },
    });
    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
    );
    await screen.getByRole("button", { name: "Retry monitor" }).click();

    await expect.element(screen.getByText("194.1%", { exact: true }).first()).toBeVisible();
    await expect.element(screen.getByText(/1\.9 cores busy/)).toBeVisible();
    await expect
      .element(screen.getByText("This machine does not report a CPU speed limit."))
      .toBeVisible();
    // Nothing in a group's cell draws a meter that says nothing: the numbers are the information.
    expect(screen.container.querySelectorAll("span.absolute.h-0\\.5")).toHaveLength(0);
    expect(screen.container.textContent).not.toContain("Unknown");
  });

  it.each([false, true])(
    "refreshes the changed history window only in the retry environment (switch environment: %s)",
    async (switchEnvironment) => {
      using fixture = setup({ holdRetry: true });
      const view = (selectedEnvironment: EnvironmentId) => (
        <RegistryContext.Provider value={fixture.registry}>
          <ResourceTelemetryDiagnostics environmentId={selectedEnvironment} />
        </RegistryContext.Provider>
      );
      await using screen = await render(view(environmentId));
      await expect.element(screen.getByText(historyError, { exact: true })).toBeVisible();
      await screen.getByRole("button", { name: "Retry monitor" }).click();
      await expect.element(screen.getByRole("button", { name: "Retry monitor" })).toBeDisabled();
      const selectedEnvironment = switchEnvironment ? EnvironmentId.make("other") : environmentId;
      if (switchEnvironment) await screen.rerender(view(selectedEnvironment));
      await screen.getByRole("button", { name: "5m", exact: true }).click();
      await expect.element(screen.getByText(historyError, { exact: true })).toBeVisible();
      const selectedKey = `${selectedEnvironment}:300000`;
      expect(fixture.registry.get(fixture.historyQueries(selectedKey))._tag).toBe("Failure");
      fixture.historyReads.mockClear();

      await act(() => fixture.releaseRetry());

      if (switchEnvironment) {
        await expect.element(screen.getByRole("button", { name: "Retry monitor" })).toBeEnabled();
        await expect.element(screen.getByText(historyError, { exact: true })).toBeVisible();
        expect(fixture.registry.get(fixture.historyQueries(selectedKey))._tag).toBe("Failure");
        expect(fixture.historyReads).not.toHaveBeenCalled();
      } else {
        await expect.element(screen.getByText(startError, { exact: true })).not.toBeInTheDocument();
        await expect
          .element(screen.getByText(historyError, { exact: true }))
          .not.toBeInTheDocument();
        expect(fixture.registry.get(fixture.historyQueries(selectedKey))._tag).toBe("Success");
        expect(fixture.historyReads.mock.calls.map(([key]) => key)).toEqual([selectedKey]);
        await screen.getByRole("button", { name: "15m", exact: true }).click();
        await expect
          .element(screen.getByText(historyError, { exact: true }))
          .not.toBeInTheDocument();
      }
      expect(fixture.registry.get(fixture.historyQueries(`${environmentId}:900000`))._tag).toBe(
        "Success",
      );
      expect(monitor.retry).toHaveBeenCalledExactlyOnceWith({ environmentId, input: {} });
    },
  );

  it("keeps the failed monitor and history errors visible when retry fails", async () => {
    using fixture = setup({ retryFails: true });
    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
    );
    await expect.element(screen.getByText(startError, { exact: true })).toBeVisible();
    await expect.element(screen.getByText(historyError, { exact: true })).toBeVisible();

    await screen.getByRole("button", { name: "Retry monitor" }).click();

    await expect.element(screen.getByRole("button", { name: "Retry monitor" })).toBeEnabled();
    expect(monitor.retry).toHaveBeenCalledExactlyOnceWith({ environmentId, input: {} });
    await expect.element(screen.getByText(startError, { exact: true })).toBeVisible();
    await expect.element(screen.getByText(historyError, { exact: true })).toBeVisible();
  });

  it("stops showing refresh as pending after the first live snapshot arrives", async () => {
    using fixture = setup();
    const liveTelemetry = Atom.make<
      AsyncResult.AsyncResult<ResourceTelemetrySnapshot, MonitorError>
    >(AsyncResult.initial(true)).pipe(Atom.keepAlive);
    monitor.telemetry.mockImplementation(() => liveTelemetry);

    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
    );
    const refreshButton = screen.getByRole("button", { name: "Refresh resource telemetry" });
    await expect.element(refreshButton).toBeDisabled();

    await act(() => {
      fixture.registry.set(
        liveTelemetry,
        AsyncResult.waiting(AsyncResult.success(fixture.snapshot)),
      );
    });
    await expect.element(refreshButton).toBeEnabled();
  });

  it("stops showing refresh as pending after a live subscription error", async () => {
    using fixture = setup();
    const liveTelemetry = Atom.make<
      AsyncResult.AsyncResult<ResourceTelemetrySnapshot, MonitorError>
    >(AsyncResult.waiting(AsyncResult.fail(new MonitorError({ message: startError })))).pipe(
      Atom.keepAlive,
    );
    monitor.telemetry.mockImplementation(() => liveTelemetry);

    await using screen = await render(
      <RegistryContext.Provider value={fixture.registry}>
        <ResourceTelemetryDiagnostics environmentId={environmentId} />
      </RegistryContext.Provider>,
    );
    await expect.element(screen.getByText(startError, { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Refresh resource telemetry" }))
      .toBeEnabled();
  });
});
