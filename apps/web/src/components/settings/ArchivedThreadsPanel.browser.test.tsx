import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { Button } from "../ui/button";
import { ArchivedThreadsPanel } from "./ArchivedThreadsPanel";

const state = vi.hoisted(() => ({ closeAppModal: vi.fn() }));

vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: () =>
    ({
      scope: { kind: "all", environmentIds: [] },
      groups: [],
      environments: [],
    }) as unknown as ReturnType<Awaited<ReturnType<typeof original>>["useSettingsScope"]>,
}));

vi.mock(import("../../lib/archivedThreadsState"), async (original) => ({
  ...(await original()),
  useArchivedThreadSnapshots: () => ({
    snapshots: [],
    error: null,
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock(import("../../hooks/useThreadActions"), async (original) => ({
  ...(await original()),
  useThreadActions: () =>
    ({
      unarchiveThread: vi.fn(),
      confirmAndDeleteThread: vi.fn(),
    }) as unknown as ReturnType<Awaited<ReturnType<typeof original>>["useThreadActions"]>,
}));

vi.mock(import("../sidebar/mainAppLocation"), async (original) => ({
  ...(await original()),
  useCloseAppModal: () => state.closeAppModal,
}));

describe("archived threads page with nothing archived", () => {
  it("says how a thread gets here and offers Go to threads as a quiet button, not the filled primary", async () => {
    await using screen = await render(
      <div className="w-[880px]">
        <ArchivedThreadsPanel />
        <Button>Reference primary</Button>
      </div>,
      { router: "/settings/archived" },
    );

    await expect.element(page.getByText("No archived threads")).toBeVisible();
    await expect.element(page.getByText(/Archive a thread from its menu/)).toBeVisible();
    const go = page.getByRole("button", { name: "Go to threads" }).element();
    const primary = page.getByRole("button", { name: "Reference primary" }).element();
    expect(getComputedStyle(go).backgroundColor).not.toBe(
      getComputedStyle(primary).backgroundColor,
    );
    expect(screen.container.querySelector("[data-settings-empty-preview]")).not.toBeNull();

    await userEvent.click(page.getByRole("button", { name: "Go to threads" }));
    expect(state.closeAppModal).toHaveBeenCalledOnce();
  });
});
