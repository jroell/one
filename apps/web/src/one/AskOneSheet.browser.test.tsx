import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { use } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { AskOneSheetHost } from "./AskOneSheet";
import { useAskOneSheetStore } from "./askOneSheetStore";
import { GuidedBridgeScopeContext } from "./guidedBridgeScope";

function ChatViewStub(props: { readonly threadId: string }) {
  return (
    <div data-testid="conversation" data-scope={use(GuidedBridgeScopeContext)}>
      {props.threadId}
    </div>
  );
}

vi.mock(import("~/components/ChatView"), () => ({ default: ChatViewStub as never }));

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
  useAskOneSheetStore.getState().begin({ title: "Usage providers", question: "What is a hub?" });
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
    useAskOneSheetStore.getState().attach(threadRef);
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
