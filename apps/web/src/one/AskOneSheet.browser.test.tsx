import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { use, useSyncExternalStore } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { AskOneSheetHost } from "./AskOneSheet";
import { useAskOneSheetStore } from "./askOneSheetStore";
import { GuidedBridgeScopeContext } from "./guidedBridgeScope";
import { getWorkspaceMode, setWorkspaceMode } from "./workspaceMode";

function ChatViewStub(props: { readonly threadId: string }) {
  return (
    <div data-testid="conversation" data-scope={use(GuidedBridgeScopeContext)}>
      {props.threadId}
    </div>
  );
}

vi.mock(import("~/components/ChatView"), () => ({ default: ChatViewStub as never }));

/** The status of the open thread's latest run, as the server reports it; null: no run yet. */
const run = vi.hoisted(() => ({ status: null as string | null, listeners: new Set<() => void>() }));
function setRunStatus(status: string | null) {
  run.status = status;
  for (const listener of run.listeners) listener();
}
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: (() => {
    const status = useSyncExternalStore(
      (listener) => {
        run.listeners.add(listener);
        return () => run.listeners.delete(listener);
      },
      () => run.status,
    );
    return status === null ? null : { latestRun: { status } };
  }) as never,
}));

const threadRef = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread-1"));

function openSheet() {
  useAskOneSheetStore.getState().show({ thread: threadRef, title: "Usage providers" });
  return { [Symbol.dispose]: () => useAskOneSheetStore.getState().close() };
}

it("the Ask One sheet opens above a full-window page with its conversation in the sheet scope, and Escape closes it", async () => {
  // A full-window page at the dialog layer, as Settings is.
  const page = document.createElement("div");
  page.style.cssText = "position: fixed; inset: 0; z-index: 50; background: rgb(10 10 10)";
  document.body.append(page);
  await using _screen = await render(<AskOneSheetHost />);
  using _sheet = openSheet();

  const popup = await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-ask-one-sheet]");
    expect(element).not.toBeNull();
    return element!;
  });
  expect(popup.textContent).toContain("Usage providers");
  const conversation = popup.querySelector<HTMLElement>('[data-testid="conversation"]')!;
  expect(conversation.dataset.scope).toBe("sheet");
  expect(conversation.textContent).toBe("thread-1");
  // On top of the page, not under it, and the page behind is not dimmed or blurred.
  await vi.waitFor(() => {
    const box = popup.getBoundingClientRect();
    const atSheet = document.elementFromPoint(box.left + box.width / 2, box.top + 200);
    expect(popup.contains(atSheet)).toBe(true);
  });
  const backdrop = document.querySelector<HTMLElement>('[data-slot="sheet-backdrop"]')!;
  expect(getComputedStyle(backdrop).backdropFilter).toBe("none");

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(useAskOneSheetStore.getState().open).toBe(false));
  await vi.waitFor(() => expect(document.querySelector("[data-ask-one-sheet]")).toBeNull());
  page.remove();
});

it("Open as a thread moves the conversation to its own thread and closes the sheet", async () => {
  await using screen = await render(<AskOneSheetHost />);
  const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
  using _sheet = openSheet();

  const button = await vi.waitFor(() => {
    const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Open as a thread",
    );
    expect(element).toBeDefined();
    return element!;
  });
  await act(() => button.click());

  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env", threadId: "thread-1" },
    }),
  );
  expect(useAskOneSheetStore.getState().open).toBe(false);
});

it("the Ask One sheet shows the person's question and a working arc the moment it opens, before there is a thread, and marks the page for room", async () => {
  await using _screen = await render(<AskOneSheetHost />);
  const generation = useAskOneSheetStore
    .getState()
    .begin({ title: "Usage providers", question: "What is a hub?" });
  try {
    const popup = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-ask-one-sheet]");
      expect(element).not.toBeNull();
      return element!;
    });
    // No thread yet: the question, the arc and a disabled "Open as a thread" fill the sheet.
    expect(useAskOneSheetStore.getState().thread).toBeNull();
    const pending = popup.querySelector<HTMLElement>("[data-ask-one-pending]")!;
    expect(pending.textContent).toContain("What is a hub?");
    expect(pending.querySelector("[data-working-arc]")).not.toBeNull();
    expect(popup.querySelector('[data-testid="conversation"]')).toBeNull();
    const asThread = [...popup.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Open as a thread",
    )!;
    expect(asThread.disabled).toBe(true);
    expect(popup.textContent).toContain("Ask One");
    expect(document.documentElement.dataset.askOneSheet).toBeDefined();

    // The thread arrives: the conversation mounts under the same question, which stays until the
    // conversation has a message of its own (the stub never does, so it stays).
    useAskOneSheetStore.getState().attach(generation, threadRef);
    await vi.waitFor(() =>
      expect(popup.querySelector('[data-testid="conversation"]')).not.toBeNull(),
    );
    expect(popup.querySelector("[data-ask-one-pending]")?.hasAttribute("data-done")).toBe(false);
  } finally {
    useAskOneSheetStore.getState().close();
    await vi.waitFor(() => expect(document.querySelector("[data-ask-one-sheet]")).toBeNull());
    // Emptied after the exit, and the page's room is given back.
    expect(useAskOneSheetStore.getState().question).toBeNull();
    expect(document.documentElement.dataset.askOneSheet).toBeUndefined();
  }
});

async function openPendingSheet() {
  const generation = useAskOneSheetStore
    .getState()
    .begin({ title: "Usage providers", question: "What is a hub?" });
  useAskOneSheetStore.getState().attach(generation, threadRef);
  const popup = await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-ask-one-sheet]");
    expect(element).not.toBeNull();
    expect(element!.querySelector('[data-testid="conversation"]')).not.toBeNull();
    return element!;
  });
  return {
    popup,
    pending: () => popup.querySelector<HTMLElement>("[data-ask-one-pending]")!,
    conversation: popup.querySelector<HTMLElement>('[data-testid="conversation"]')!,
    [Symbol.dispose]: () => {
      setRunStatus(null);
      useAskOneSheetStore.getState().close();
    },
  };
}

it("the Ask One sheet's Thinking cover stays gone after the answer stage has shown and left without an answer", async () => {
  await using _screen = await render(<AskOneSheetHost />);
  using sheet = await openPendingSheet();
  expect(sheet.pending().hasAttribute("data-done")).toBe(false);

  // The stage appears while the answer takes shape, then leaves when the run fails: no answer row.
  const stage = document.createElement("div");
  stage.setAttribute("data-chat-stage", "");
  stage.setAttribute("data-shown", "");
  sheet.conversation.append(stage);
  await vi.waitFor(() => expect(sheet.pending().hasAttribute("data-done")).toBe(true));
  // The sheet's own observer is registered first, so it has seen the removal when this one fires.
  const seen = new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      resolve();
    });
    observer.observe(sheet.conversation, { childList: true, subtree: true });
  });
  stage.remove();
  await seen;
  await act(async () => {});
  expect(sheet.pending().hasAttribute("data-done")).toBe(true);
});

it("the Ask One sheet's Thinking cover hands over when the first run fails before any answer appears", async () => {
  await using _screen = await render(<AskOneSheetHost />);
  using sheet = await openPendingSheet();
  expect(sheet.pending().hasAttribute("data-done")).toBe(false);

  // No stage and no assistant row ever render, as when the provider refuses the run at once.
  act(() => setRunStatus("failed"));
  await vi.waitFor(() => expect(sheet.pending().hasAttribute("data-done")).toBe(true));
  expect(getComputedStyle(sheet.pending()).pointerEvents).toBe("none");
});

it("Open as a thread keeps Chat mode, and closing the sheet any other way gives back the mode it was opened from", async () => {
  await using screen = await render(<AskOneSheetHost />);
  vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
  const store = useAskOneSheetStore.getState();
  const leave = async () => {
    await vi.waitFor(() => expect(document.querySelector("[data-ask-one-sheet]")).toBeNull());
    await vi.waitFor(() => expect(useAskOneSheetStore.getState().thread).toBeNull());
  };

  setWorkspaceMode("code");
  try {
    // Asking in the sheet shows Chat while it is open; closing it puts Code back.
    store.attach(store.begin({ title: "Usage", question: "What is a hub?" }), threadRef);
    useAskOneSheetStore.getState().enterChatMode();
    expect(getWorkspaceMode()).toBe("chat");
    await vi.waitFor(() => expect(document.querySelector("[data-ask-one-sheet]")).not.toBeNull());
    useAskOneSheetStore.getState().close();
    await leave();
    expect(getWorkspaceMode()).toBe("code");

    // Opening it as a thread is choosing Chat: it stays.
    store.attach(store.begin({ title: "Usage", question: "What is a hub?" }), threadRef);
    useAskOneSheetStore.getState().enterChatMode();
    const button = await vi.waitFor(() => {
      const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.trim() === "Open as a thread",
      );
      expect(element?.disabled).toBe(false);
      return element!;
    });
    await act(() => button.click());
    await leave();
    expect(getWorkspaceMode()).toBe("chat");
  } finally {
    setWorkspaceMode("code");
  }
});
