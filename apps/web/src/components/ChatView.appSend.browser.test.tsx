import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the test.
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { waitForComposerSend } from "~/one/composerSendBridge";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  rejectPendingCommand,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

const NOTES = "Explain the Providers page.";

async function openThread(name: string, options: { readonly hold: boolean }) {
  const thread = threadWithHistory(name, 1);
  const environment = installFakeEnvironment([thread], {
    acceptCommands: true,
    ...(options.hold ? { holdCommand: (command) => command.type === "message.dispatch" } : {}),
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  const key = `${ENVIRONMENT_ID}:${thread.id}`;
  const bridge = await waitForComposerSend(key, 5_000);
  if (bridge === null) throw new Error("The composer never offered its send.");
  return {
    thread,
    bridge,
    key,
    [Symbol.asyncDispose]: async () => (
      await app[Symbol.asyncDispose]?.(),
      environment[Symbol.dispose]()
    ),
  };
}

const notesOf = (text: string) =>
  dispatchedCommands().flatMap((command) =>
    command.type === "message.dispatch" && command.text === text
      ? [command.context?.agentContext]
      : [],
  );

it("a guided send reports success only after the server accepts the turn, with the notes on that one message", async () => {
  await using opened = await openThread("app-send-accepted", { hold: false });
  const result = await opened.bridge.send({ text: "What is this?", agentContext: NOTES });
  expect(result.ok).toBe(true);
  expect(notesOf("What is this?")).toEqual([NOTES]);
});

it("a refusal that arrives after the request went out comes back as a rejection, leaves the composer empty and gives the next typed message no notes", async () => {
  await using opened = await openThread("app-send-rejected", { hold: true });
  let settled = false;
  const sending = opened.bridge
    .send({ text: "What is this?", agentContext: NOTES })
    .then((value) => {
      settled = true;
      return value;
    });
  await vi.waitFor(() => expect(notesOf("What is this?")).toEqual([NOTES]));
  // The request is out and held: nothing has been accepted, so nothing has been reported.
  expect(settled).toBe(false);

  await rejectPendingCommand("The server refused that question.");
  expect(await sending).toEqual({
    ok: false,
    reason: "rejected",
    message: "The server refused that question.",
  });
  const editor = page.getByTestId("composer-editor");
  expect(editor.element().textContent ?? "").not.toContain("What is this?");

  await userEvent.click(editor);
  await userEvent.keyboard("Typed by hand{Enter}");
  await vi.waitFor(() => expect(notesOf("Typed by hand")).toEqual([undefined]));
});

it("a guided send refuses to run over anything in the composer, not only typed text", async () => {
  await using opened = await openThread("app-send-slots", { hold: false });
  const image = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
  await act(() =>
    useComposerDraftStore.getState().addImage(scopeThreadRef(ENVIRONMENT_ID, opened.thread.id), {
      type: "image",
      id: "shot-1",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: image.size,
      previewUrl: URL.createObjectURL(image),
      file: image,
    }),
  );
  const result = await opened.bridge.send({ text: "What is this?", agentContext: NOTES });
  expect(result).toEqual({ ok: false, reason: "draft-in-the-way" });
  expect(notesOf("What is this?")).toEqual([]);
});
