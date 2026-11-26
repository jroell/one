import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

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
  useProject: (() =>
    state.params.threadId
      ? {
          title: "orbit-api",
          environmentId: "env-1",
          workspaceRoot: "/work/orbit-api",
          faviconPath: null,
          projectIcon: { kind: "monogram", text: "OA", color: "gold" },
        }
      : null) as never,
}));

import { ComposerHandleContext, type ComposerHandleRef } from "~/composerHandleContext";
import { dispatchCommandPalette, useCommandPaletteStore } from "~/commandPaletteStore";
import { act, render } from "../../test/render";
import { CodeWelcome, ReviewChangesContext } from "./OneEmptyState";

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
}

describe("code mode welcome", () => {
  it("greets in serif with the project name beneath and four starters in a server thread", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    await using screen = await render(
      <ReviewChangesContext value={{ available: true, open: () => {} }}>
        <CodeWelcome />
      </ReviewChangesContext>,
    );
    const title = screen.getByRole("heading", { name: "What are we building?" });
    await expect.element(title).toBeVisible();
    expect(getComputedStyle(title.element()).fontFamily).toContain("Iowan Old Style");
    // The project is a chip with its icon, not a grey line of text.
    const chip = screen.container.querySelector<HTMLElement>("[data-one-project-chip]");
    expect(chip?.textContent).toContain("orbit-api");
    expect(chip?.children).toHaveLength(2);
    const starters = screen.getByRole("list", { name: "Ways to start" }).getByRole("button");
    const labels = starters.elements().map((button) => button.textContent ?? "");
    expect(labels).toHaveLength(4);
    expect(labels[0]).toMatch(/^Mention a file/);
    expect(labels[1]).toMatch(/^Search the project/);
    expect(labels[2]).toMatch(/^Review changes/);
    expect(labels[3]).toMatch(/^Command palette/);
    // No starter carries a keyboard hint.
    expect(starters.elements().some((button) => button.querySelector("kbd") !== null)).toBe(false);
  });

  it("offers no Review changes when the conversation says the thread has no diff", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    await using screen = await render(
      <ReviewChangesContext value={{ available: false, open: () => {} }}>
        <CodeWelcome />
      </ReviewChangesContext>,
    );
    expect(screen.getByRole("button", { name: /Review changes/ }).elements()).toHaveLength(0);
    // The set stays four: a file takes the place of the diff.
    expect(
      screen.getByRole("list", { name: "Ways to start" }).getByRole("button").elements(),
    ).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Open a file/ }).elements()).toHaveLength(1);
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
    await userEvent.click(screen.getByRole("button", { name: /Command palette/ }));
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "command" });
  });

  it("runs the conversation's own open-diff action from Review changes", async () => {
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    let opened = 0;
    await using screen = await render(
      <ReviewChangesContext value={{ available: true, open: () => void opened++ }}>
        <CodeWelcome />
      </ReviewChangesContext>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(opened).toBe(1);
  });

  it("lays the starters out as an even two-column grid", async () => {
    await page.viewport(1000, 800);
    reset();
    state.params = { environmentId: "env-1", threadId: "thread-1" };
    await using screen = await render(
      <div style={{ width: 640 }}>
        <ReviewChangesContext value={{ available: true, open: () => {} }}>
          <CodeWelcome />
        </ReviewChangesContext>
      </div>,
    );
    const chips = screen
      .getByRole("list", { name: "Ways to start" })
      .getByRole("button")
      .elements()
      .map((button) => button.getBoundingClientRect());
    expect(new Set(chips.map((chip) => Math.round(chip.width))).size).toBe(1);
    expect(new Set(chips.map((chip) => Math.round(chip.left))).size).toBe(2);
  });
});
