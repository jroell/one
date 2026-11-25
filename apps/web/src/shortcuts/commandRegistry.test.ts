import { describe, expect, it, vi } from "vite-plus/test";

import {
  isCommandAvailable,
  registerCommandHandlers,
  runRegisteredCommand,
} from "./commandRegistry";

describe("command registry", () => {
  it("runs the newest registration that can run, and falls back as scopes unmount", () => {
    using scopes = new DisposableStack();
    const outer = vi.fn();
    const inner = vi.fn();
    scopes.defer(registerCommandHandlers({ "diff.toggle": { run: outer } }));
    const disposeInner = registerCommandHandlers({ "diff.toggle": { run: inner } });

    expect(runRegisteredCommand("diff.toggle")).toBe(true);
    disposeInner();
    expect(runRegisteredCommand("diff.toggle")).toBe(true);

    expect(inner).toHaveBeenCalledOnce();
    expect(outer).toHaveBeenCalledOnce();
  });

  it("skips a registration that cannot run now and one that declines", () => {
    using scopes = new DisposableStack();
    const older = vi.fn();
    const declined = vi.fn(() => false as const);
    const blocked = vi.fn();
    scopes.defer(registerCommandHandlers({ "thread.next": { run: older } }));
    scopes.defer(registerCommandHandlers({ "thread.next": { run: declined } }));
    scopes.defer(registerCommandHandlers({ "thread.next": { run: blocked, canRun: () => false } }));

    expect(isCommandAvailable("thread.next")).toBe(true);
    expect(runRegisteredCommand("thread.next")).toBe(true);

    expect(blocked).not.toHaveBeenCalled();
    expect(declined).toHaveBeenCalledOnce();
    expect(older).toHaveBeenCalledOnce();
  });

  it("reports a command with no registration, or none that can run, as unavailable", () => {
    using scopes = new DisposableStack();
    const run = vi.fn();
    scopes.defer(registerCommandHandlers({ "view.reopenClosed": { run, canRun: () => false } }));

    expect(isCommandAvailable("view.reopenClosed")).toBe(false);
    expect(runRegisteredCommand("view.reopenClosed")).toBe(false);
    expect(isCommandAvailable("sidebar.toggle")).toBe(false);
    expect(runRegisteredCommand("sidebar.toggle")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
