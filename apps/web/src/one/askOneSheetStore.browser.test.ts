import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { useAskOneSheetStore } from "./askOneSheetStore";
import { getWorkspaceMode, setWorkspaceMode } from "./workspaceMode";

const first = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread-1"));
const second = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread-2"));

function freshSheet(): Disposable {
  const clear = () => {
    useAskOneSheetStore.getState().close();
    useAskOneSheetStore.getState().reset();
    setWorkspaceMode("code");
  };
  clear();
  return { [Symbol.dispose]: clear };
}

it("a question that was closed or replaced cannot attach its thread to, or close, the sheet that took its place", () => {
  using _fresh = freshSheet();
  const store = useAskOneSheetStore.getState();

  const closed = store.begin({ title: "One", question: "First?" });
  store.close();
  // The thread of a question the person closed does not reopen into a closed sheet.
  store.attach(closed, first);
  expect(useAskOneSheetStore.getState().thread).toBeNull();

  const older = store.begin({ title: "Two", question: "Second?" });
  const newer = store.begin({ title: "Three", question: "Third?" });
  store.attach(older, first);
  expect(useAskOneSheetStore.getState().thread).toBeNull();
  // The older question giving up leaves the newer sheet open.
  store.close(older);
  expect(useAskOneSheetStore.getState().open).toBe(true);
  store.attach(newer, second);
  expect(useAskOneSheetStore.getState().thread).toEqual(second);
  store.close(newer);
  expect(useAskOneSheetStore.getState().open).toBe(false);
});

it("a sheet that is asked again while it is still leaving is not emptied when the old exit ends", () => {
  using _fresh = freshSheet();
  const store = useAskOneSheetStore.getState();
  store.begin({ title: "One", question: "First?" });
  store.close();
  const again = store.begin({ title: "Two", question: "Second?" });
  // The first exit finishing after the second opening must not wipe it.
  store.reset();
  expect(useAskOneSheetStore.getState().question).toBe("Second?");
  expect(useAskOneSheetStore.getState().isLive(again)).toBe(true);
});

it("the workspace goes back to the mode it was in once the sheet has left, unless the person kept Chat", () => {
  using _fresh = freshSheet();
  const store = useAskOneSheetStore.getState();
  store.begin({ title: "One", question: "First?" });
  useAskOneSheetStore.getState().enterChatMode();
  expect(getWorkspaceMode()).toBe("chat");
  useAskOneSheetStore.getState().close();
  // Still Chat while the sheet is leaving, so the page behind does not flip under it.
  expect(getWorkspaceMode()).toBe("chat");
  useAskOneSheetStore.getState().reset();
  expect(getWorkspaceMode()).toBe("code");

  store.begin({ title: "Two", question: "Second?" });
  useAskOneSheetStore.getState().enterChatMode();
  useAskOneSheetStore.getState().keepMode();
  useAskOneSheetStore.getState().close();
  useAskOneSheetStore.getState().reset();
  expect(getWorkspaceMode()).toBe("chat");

  // Already in Chat when asking: nothing to give back.
  store.begin({ title: "Three", question: "Third?" });
  useAskOneSheetStore.getState().enterChatMode();
  useAskOneSheetStore.getState().close();
  useAskOneSheetStore.getState().reset();
  expect(getWorkspaceMode()).toBe("chat");
});
