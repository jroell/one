import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the test.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { rememberGuidedThread } from "~/one/guidedThread";
import { setWorkspaceMode } from "~/one/workspaceMode";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

async function openGuidedThread(name: string, mode: "chat" | "code") {
  setWorkspaceMode(mode);
  onTestFinished(() => {
    setWorkspaceMode("code");
    window.sessionStorage.removeItem("one:guided-thread");
  });
  const thread = threadWithHistory(name, 1);
  const environment = installFakeEnvironment([thread], { acceptCommands: true });
  rememberGuidedThread(`${ENVIRONMENT_ID}:${thread.id}`, {
    asked: "Claude",
    skipped: { name: "Gemini", resetsAt: "2099-11-30T16:46:00.000Z" },
    actions: [{ label: "Open Usage", href: "/settings/providers" }],
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
  return {
    router,
    [Symbol.asyncDispose]: async () => {
      await app[Symbol.asyncDispose]?.();
      environment[Symbol.dispose]();
    },
  };
}

it("a guided thread says which provider answered and why, and its chips open the place the answer names", async () => {
  await using opened = await openGuidedThread("guided-footer", "chat");
  await expect.element(page.getByText(/^Asked Codex: Gemini is out until .+\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Open Usage" }).click();
  await vi.waitFor(() => expect(opened.router.state.location.pathname).toBe("/settings/providers"));
});

it("Code mode shows no guided line or chips", async () => {
  await using _opened = await openGuidedThread("guided-footer-code", "code");
  expect(document.querySelector("[data-guided-footer]")).toBeNull();
});

it("a reply under a question the answer asked is sent as the person's own words, with no hidden notes", async () => {
  setWorkspaceMode("chat");
  onTestFinished(() => setWorkspaceMode("code"));
  const history = threadWithHistory("reply-chips", 1);
  const asking = {
    ...history,
    items: history.items.map((row) =>
      row.type === "assistant_message"
        ? {
            ...row,
            text: "You have one account signed in. That is enough for Usage.\n\nDo you have a second account?",
          }
        : row,
    ),
  };
  using _environment = installFakeEnvironment([asking], { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${asking.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("Do you have a second account?")).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({ type: "message.dispatch", text: "No" }),
    ),
  );
  const sent = dispatchedCommands().find(
    (command) => command.type === "message.dispatch" && command.text === "No",
  );
  expect(sent?.type === "message.dispatch" ? sent.context?.agentContext : "x").toBeUndefined();
});

it("Chat mode lights the conversation from below and Code mode does not, and while a turn works only compositor properties animate", async () => {
  const compositorOnly = new Set([
    "opacity",
    "transform",
    "rotate",
    "scale",
    "translate",
    "offset",
    "easing",
    "composite",
    "computedOffset",
  ]);
  for (const mode of ["chat", "code"] as const) {
    await using _opened = await openGuidedThread(`room-light-${mode}`, mode);
    const column = document.querySelector<HTMLElement>("[data-chat-column]")!;
    const glow = getComputedStyle(column, "::before");
    if (mode === "code") {
      expect(glow.backgroundImage).toBe("none");
      continue;
    }
    expect(glow.backgroundImage).toContain("radial-gradient");
    const resting = Number.parseFloat(glow.opacity);
    column.setAttribute("data-one-working", "");
    // Whatever runs under the column, whether an animation or a transition, changes nothing but
    // opacity or transform, so the page never repaints for it.
    const runningUnder = () =>
      document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target !== null && target !== undefined && column.contains(target);
      });
    await vi.waitFor(() => expect(runningUnder().length).toBeGreaterThan(0));
    // The browser lists the keyframes of a plain property but not always those of a custom one, so
    // each running animation's own @keyframes rule is read as well.
    const declared = (name: string): string[] => {
      const found: string[] = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSKeyframesRule && rule.name === name) {
            for (const frame of rule.cssRules) {
              const style = (frame as CSSKeyframeRule).style;
              for (let index = 0; index < style.length; index += 1) found.push(style.item(index));
            }
          }
        }
      }
      return found;
    };
    const properties = runningUnder().flatMap((animation) => [
      ...(animation.effect as KeyframeEffect).getKeyframes().flatMap((frame) => Object.keys(frame)),
      ...(animation instanceof CSSAnimation ? declared(animation.animationName) : []),
      ...(animation instanceof CSSTransition ? [animation.transitionProperty] : []),
    ]);
    expect(properties.filter((property) => !compositorOnly.has(property))).toEqual([]);
    // While a turn works the light is plainly stronger than at rest.
    await vi.waitFor(() =>
      expect(Number.parseFloat(getComputedStyle(column, "::before").opacity)).toBeGreaterThan(
        resting * 1.9,
      ),
    );
    column.removeAttribute("data-one-working");
  }
});

it("a guided answer ends in one block, in order: the replies it asks for, the links it names, then which provider answered", async () => {
  setWorkspaceMode("chat");
  onTestFinished(() => {
    setWorkspaceMode("code");
    window.sessionStorage.removeItem("one:guided-thread");
  });
  const history = threadWithHistory("guided-order", 1);
  const asking = {
    ...history,
    items: history.items.map((row) =>
      row.type === "assistant_message"
        ? {
            ...row,
            text: "A hub pools accounts. One address serves all of them.\n\nDo you have a second account?",
          }
        : row,
    ),
  };
  rememberGuidedThread(`${ENVIRONMENT_ID}:${asking.id}`, {
    asked: "Claude",
    actions: [{ label: "Open Usage limits", href: "/settings/providers" }],
  });
  using _environment = installFakeEnvironment([asking], { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${asking.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("Asked Codex.")).toBeVisible();
  const replies = document.querySelector<HTMLElement>(".one-chat-replies")!;
  const links = document.querySelector<HTMLElement>(".one-guided-links")!;
  const line = document.querySelector<HTMLElement>(".one-guided-line")!;
  const follows = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(replies, links) && follows(links, line)).toBe(true);
  // One block under the answer, not a footer apart from it: all three share the answer's row.
  const row = replies.closest("[data-timeline-row-id]");
  expect(row?.contains(links) && row?.contains(line)).toBe(true);
  // Replies send a message and links leave the conversation: never in the same row.
  expect(replies.contains(links) || links.contains(replies)).toBe(false);
  expect(replies.querySelector("a, .one-guided-link")).toBeNull();
  expect(links.querySelector(".one-chat-reply")).toBeNull();
});

it("a guided thread says nothing about its provider once a second run has answered", async () => {
  setWorkspaceMode("chat");
  onTestFinished(() => {
    setWorkspaceMode("code");
    window.sessionStorage.removeItem("one:guided-thread");
  });
  const thread = threadWithHistory("guided-two-answers", 2);
  rememberGuidedThread(`${ENVIRONMENT_ID}:${thread.id}`, {
    asked: "Claude",
    skipped: { name: "Codex", resetsAt: "2099-11-30T16:46:00.000Z" },
    actions: [{ label: "Open Usage limits", href: "/settings/providers" }],
  });
  using _environment = installFakeEnvironment([thread], { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText(`Answer 1 for ${thread.id}.`)).toBeVisible();
  expect(document.querySelector("[data-guided-footer]")).toBeNull();
});
