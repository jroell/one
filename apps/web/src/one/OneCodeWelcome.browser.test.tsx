import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({ params: {} as Record<string, string> }));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useParams: (() => state.params) as never,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: (() =>
    state.params.threadId
      ? { environmentId: "env-1", id: "thread-1", projectId: "project-1" }
      : null) as never,
  useProject: (() => (state.params.threadId ? { title: "orbit-api" } : null)) as never,
}));

import { ComposerHandleContext, type ComposerHandleRef } from "~/composerHandleContext";
import { dispatchCommandPalette, useCommandPaletteStore } from "~/commandPaletteStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { act, render } from "../../test/render";
import { CodeWelcome } from "./OneEmptyState";

function fakeComposer() {
  let text = "";
  const handle = {
    readSnapshot: () => ({ value: text }),
    insertTextAtEnd: (stem: string) => {
      text += stem;
      return true;
    },
    focusAtEnd: () => {},
  };
  return { ref: { current: handle } as unknown as ComposerHandleRef, text: () => text };
}

function reset() {
  dispatchCommandPalette({ _tag: "SetOpen", open: false });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
}

describe("code mode welcome", () => {
  it("greets in serif with the project name beneath and four starters in a server thread", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    await using screen = await render(<CodeWelcome />);
    const title = screen.getByRole("heading", { name: "What are we building?" });
    await expect.element(title).toBeVisible();
    expect(getComputedStyle(title.element()).fontFamily).toContain("Iowan Old Style");
    await expect.element(screen.getByText("orbit-api")).toBeVisible();
    const starters = screen.getByRole("list", { name: "Ways to start" }).getByRole("button");
    const labels = starters.elements().map((button) => button.textContent ?? "");
    expect(labels).toHaveLength(4);
    expect(labels[0]).toMatch(/^Mention a file/);
    expect(labels[1]).toMatch(/^Search the project/);
    expect(labels[2]).toMatch(/^Review changes/);
    expect(labels[3]).toMatch(/^Open the command palette/);
    // A starter with a binding shows its keycap; the @ starter shows the character itself.
    expect(starters.elements().every((button) => button.querySelector("kbd") !== null)).toBe(true);
  });

  it("offers no Review changes where there is no server thread to review", async () => {
    reset();
    state.params = { draftId: "draft-1" };
    await using screen = await render(<CodeWelcome />);
    expect(screen.getByRole("button", { name: /Review changes/ }).elements()).toHaveLength(0);
    expect(
      screen.getByRole("list", { name: "Ways to start" }).getByRole("button").elements(),
    ).toHaveLength(3);
  });

  it("types @ into an empty composer so the file menu opens, and leaves a draft alone", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    const composer = fakeComposer();
    await using screen = await render(
      <ComposerHandleContext value={composer.ref}>
        <CodeWelcome />
      </ComposerHandleContext>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Mention a file/ }));
    expect(composer.text()).toBe("@");
    await userEvent.click(screen.getByRole("button", { name: /Mention a file/ }));
    expect(composer.text()).toBe("@");
  });

  it("opens project search and the command palette in their own modes", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    await using screen = await render(<CodeWelcome />);
    await userEvent.click(screen.getByRole("button", { name: /Search the project/ }));
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "content" });
    await act(() => dispatchCommandPalette({ _tag: "SetOpen", open: false }));
    await userEvent.click(screen.getByRole("button", { name: /Open the command palette/ }));
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "command" });
  });

  it("opens the diff panel for the thread from Review changes", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    await using screen = await render(<CodeWelcome />);
    await userEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, {
      environmentId: "env-1",
      threadId: "thread-1",
    } as never);
    expect(panel.isOpen).toBe(true);
    expect(panel.surfaces.map((surface) => surface.kind)).toContain("diff");
  });
});
