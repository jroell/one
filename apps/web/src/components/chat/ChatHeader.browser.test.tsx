import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const persisted = vi.hoisted(() => ({ title: "" }));
const openMenu = vi.hoisted(() => vi.fn());
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() =>
    async ({ input }: { input: { title: string } }) => {
      persisted.title = input.title;
      return { _tag: "Success" };
    }) as never,
}));
vi.mock(import("~/hooks/useThreadActionMenu"), () => ({
  useThreadActionMenu: () => ({ openMenu, closeMenu: () => {}, readMenu: () => null }),
}));

import { render, stubGlobal } from "../../../test/render";
import { ChatHeader } from "./ChatHeader";
import { rememberGuidedReturn } from "~/one/guidedReturn";
import { setWorkspaceMode } from "~/one/workspaceMode";

function inMode(mode: "chat" | "code"): Disposable {
  setWorkspaceMode(mode);
  return { [Symbol.dispose]: () => setWorkspaceMode("code") };
}

function header(title: string) {
  return (
    <>
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make("thread")}
        activeThreadTitle={title}
        isServerThread
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
        onNewThreadInProject={() => {}}
      />
      <div tabIndex={0}>Outside rename</div>
    </>
  );
}

it.each(["blur", "Enter"] as const)(
  "preserves a concurrent title update when an untouched rename ends with %s",
  async (finish) => {
    persisted.title = "New thread";
    await using screen = await render(header(persisted.title));
    await screen.getByRole("button", { name: "Thread actions for New thread" }).dblClick();
    const input = screen.getByRole("textbox", { name: "Thread title" });
    await expect.element(input).toHaveValue("New thread");

    persisted.title = "Fix login redirect";
    await screen.rerender(header(persisted.title));
    if (finish === "Enter") await userEvent.keyboard("{Enter}");
    else await screen.getByText("Outside rename").click();

    await expect.element(input).not.toBeInTheDocument();
    expect(persisted.title).toBe("Fix login redirect");

    await screen.rerender(header(persisted.title));
    await screen.getByRole("button", { name: "Thread actions for Fix login redirect" }).dblClick();
    await screen.getByRole("textbox", { name: "Thread title" }).fill("My edited title");
    persisted.title = "Another concurrent title";
    await screen.rerender(header(persisted.title));
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("textbox", { name: "Thread title" }))
      .not.toBeInTheDocument();
    expect(persisted.title).toBe("My edited title");
  },
);

it("opens the thread menu on a desktop title click without waiting", async () => {
  openMenu.mockClear();
  using _bridge = stubGlobal("desktopBridge", {});
  await using screen = await render(header("New thread"));
  await screen.getByRole("button", { name: "Thread actions for New thread" }).click();
  expect(openMenu).toHaveBeenCalledOnce();
});

it("keeps the Escape that cancels a rename from also reaching window shortcuts", async () => {
  persisted.title = "New thread";
  await using screen = await render(header(persisted.title));
  await screen.getByRole("button", { name: "Thread actions for New thread" }).dblClick();
  const input = screen.getByRole("textbox", { name: "Thread title" });
  await input.fill("Unsaved title");

  // The thread find bar closes from a window keydown listener that skips handled events.
  const windowEscapes: boolean[] = [];
  const recordEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") windowEscapes.push(event.defaultPrevented);
  };
  window.addEventListener("keydown", recordEscape);
  using _listener = {
    [Symbol.dispose]: () => window.removeEventListener("keydown", recordEscape),
  };
  await userEvent.keyboard("{Escape}");

  await expect.element(input).not.toBeInTheDocument();
  expect(persisted.title).toBe("New thread");
  expect(windowEscapes).toEqual([true]);
});

it("shows a quiet way back to the page a guided conversation came from in Chat mode, and keeps it after it is used", async () => {
  using _mode = inMode("chat");
  const threadKey = scopedThreadKey(
    scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread")),
  );
  rememberGuidedReturn(threadKey, { label: "Settings / Providers", href: "/settings/providers" });
  onTestFinished(() => window.sessionStorage.removeItem("one:guided-return"));
  await using screen = await render(header("New thread"));
  const back = screen.getByRole("button", { name: "Back to Settings / Providers" });
  await expect.element(back).toBeVisible();
  await back.click();
  // Using it does not remove it: reopening the thread from the sidebar offers it again.
  await expect
    .element(screen.getByRole("button", { name: "Back to Settings / Providers" }))
    .toBeVisible();
});

it("shows no way back in Code mode, or for a thread that was not opened from a page", async () => {
  const threadKey = scopedThreadKey(
    scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread")),
  );
  onTestFinished(() => window.sessionStorage.removeItem("one:guided-return"));
  {
    using _mode = inMode("chat");
    await using screen = await render(header("New thread"));
    expect(screen.container.querySelector("[data-guided-back]")).toBeNull();
  }
  rememberGuidedReturn(threadKey, { label: "Settings", href: "/settings" });
  using _mode = inMode("code");
  await using screen = await render(header("New thread"));
  expect(screen.container.querySelector("[data-guided-back]")).toBeNull();
});
