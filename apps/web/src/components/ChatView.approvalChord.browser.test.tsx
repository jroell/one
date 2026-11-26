import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { openCommandPalette } from "~/commandPaletteBus";
// The route loads ChatView lazily, and its first transform takes seconds; load it before the test.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  emitThreadEvent,
  installFakeEnvironment,
  isThreadSubscribed,
  runningRun,
  threadWithApproval,
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

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const APPROVE = "{Meta>}{Shift>}y{/Shift}{/Meta}";
const DECLINE = "{Meta>}{Shift>}u{/Shift}{/Meta}";

const answers = () =>
  dispatchedCommands().flatMap((command) =>
    command.type === "runtime-request.respond" ? [command.decision] : [],
  );

async function openThreadWithApproval(name: string, turns: number) {
  await page.viewport(1280, 800);
  const thread = threadWithApproval(name, "rm -rf build", turns);
  const environment = installFakeEnvironment([thread], { acceptCommands: true });
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
  const card = () => document.querySelector<HTMLElement>("[data-approval-card]");
  await vi.waitFor(() => expect(card()).not.toBeNull(), { timeout: 15_000 });
  return {
    thread,
    router,
    card,
    [Symbol.asyncDispose]: async () => {
      await app[Symbol.asyncDispose]();
      environment[Symbol.dispose]();
    },
  };
}

const onScreen = (element: HTMLElement | null) => {
  if (element === null) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
};

async function settled(card: () => HTMLElement | null) {
  let last: number | null | undefined;
  await vi.waitFor(
    () => {
      // A card the list has unmounted stays where it is until the list mounts it again.
      const top = card()?.getBoundingClientRect().top ?? null;
      const still = top === last;
      last = top;
      expect(still).toBe(true);
    },
    { timeout: 5000, interval: 150 },
  );
}

it("approves the waiting command from the keyboard when its card is on screen", async () => {
  await using view = await openThreadWithApproval("chord-visible", 1);
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  await userEvent.keyboard(APPROVE);
  await vi.waitFor(() => expect(answers()).toEqual(["accept"]));
});

it("leaves the waiting command unanswered when the right panel is maximized over the chat", async () => {
  await using view = await openThreadWithApproval("chord-maximized", 1);
  await page.getByRole("button", { name: "Toggle right panel", exact: true }).click();
  await page.getByRole("button", { name: /^Files/ }).click();
  await page.getByRole("button", { name: "Maximize panel", exact: true }).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-chat-column-maximized-away="true"]')).not.toBeNull(),
  );
  await userEvent.keyboard(APPROVE);
  await userEvent.keyboard(DECLINE);
  // Commands go out in the order of the keys, so one answer after the panel is back means the
  // two chords above sent none.
  await page.getByRole("button", { name: "Restore panel size", exact: true }).click();
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  await userEvent.keyboard(DECLINE);
  await vi.waitFor(() => expect(answers()).toEqual(["decline"]));
});

it("brings a card scrolled out of view back on the chord and answers only on the next press", async () => {
  await using view = await openThreadWithApproval("chord-scrolled", 40);
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  // A wheel scroll is what the person does; it also ends the timeline's follow of the newest row.
  const rect = view.card()!.getBoundingClientRect();
  await cdp().send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: rect.left + 10,
    y: rect.top + 10,
    deltaX: 0,
    deltaY: -30_000,
  });
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(false));
  await settled(view.card);
  expect(onScreen(view.card())).toBe(false);
  await userEvent.keyboard(APPROVE);
  // The press shows the card and does not approve what the person has not seen.
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true), { timeout: 5000 });
  expect(answers()).toEqual([]);
  // The reveal scrolls smoothly; a second press while the card still moves only reveals again.
  await settled(view.card);
  await userEvent.keyboard(APPROVE);
  await vi.waitFor(() => expect(answers()).toEqual(["accept"]));
});

it("ignores both chords while the boot handoff holds the app out of sight", async () => {
  await using view = await openThreadWithApproval("chord-boot-hold", 1);
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  document.documentElement.dataset.oneHandoff = "hold";
  using _hold = { [Symbol.dispose]: () => delete document.documentElement.dataset.oneHandoff };
  await userEvent.keyboard(APPROVE);
  await userEvent.keyboard(DECLINE);
  delete document.documentElement.dataset.oneHandoff;
  // Commands go out in the order of the keys: only the last chord may have sent an answer.
  await userEvent.keyboard(DECLINE);
  await vi.waitFor(() => expect(answers()).toEqual(["decline"]));
});

it("sends no answer from the chords while the command palette is open (the palette's own key guard stops them)", async () => {
  await using view = await openThreadWithApproval("chord-palette", 1);
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  await act(() => openCommandPalette());
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard(APPROVE);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  // Commands go out in the order of the keys: only the last chord may have sent an answer.
  await userEvent.keyboard(DECLINE);
  await vi.waitFor(() => expect(answers()).toEqual(["decline"]));
});

it("sends no answer from the chords while the Settings sheet is open", async () => {
  await using view = await openThreadWithApproval("chord-settings", 1);
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  await view.router.navigate({ to: "/settings" });
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard(APPROVE);
  view.router.history.back();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  await userEvent.keyboard(DECLINE);
  await vi.waitFor(() => expect(answers()).toEqual(["decline"]));
});

it("sends no answer from the chords while a layer outside the app covers the card (the visibility check stops them)", async () => {
  await using view = await openThreadWithApproval("chord-cover", 1);
  await vi.waitFor(() => expect(onScreen(view.card())).toBe(true));
  const cover = document.createElement("div");
  cover.style.cssText = "position: fixed; inset: 0; z-index: 2147483000;";
  document.body.append(cover);
  await userEvent.keyboard(APPROVE);
  cover.remove();
  await userEvent.keyboard(DECLINE);
  await vi.waitFor(() => expect(answers()).toEqual(["decline"]));
});

it("stops the composer's light while a turn waits on an approval and runs it again once the turn resumes", async () => {
  await using view = await openThreadWithApproval("light-approval", 1);
  await vi.waitFor(() => expect(isThreadSubscribed(view.thread.id)).toBe(true));
  const comet = () =>
    getComputedStyle(document.querySelector("[data-one-reflect] > .one-reflection")!, "::before")
      .animationName;
  const live = runningRun(view.thread.id, "light-approval-live", 2, "light-approval-live-user");
  await act(() => emitThreadEvent(view.thread.id, { type: "run.created", payload: live }));
  // The agent is running, but its request waits on the person: not "working".
  await vi.waitFor(() => expect(document.querySelector("[data-chat-column]")).not.toBeNull());
  expect(document.querySelector("[data-one-working]")).toBeNull();
  expect(comet()).toBe("none");
  const request = view.thread.runtimeRequests![0]!;
  await act(() =>
    emitThreadEvent(view.thread.id, {
      type: "runtime-request.updated",
      payload: { ...request, status: "resolved", resolvedAt: request.createdAt },
    }),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-approval-card]")).toBeNull());
  await vi.waitFor(() =>
    expect(document.querySelector("[data-chat-column][data-one-working]")).not.toBeNull(),
  );
  expect(comet()).toBe("one-orbit");
});
