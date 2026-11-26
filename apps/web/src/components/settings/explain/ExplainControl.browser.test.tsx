import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../../test/render";
import { SettingsRow } from "../settingsLayout";
import { ExplainControl } from "./ExplainControl";
import { explainTopic } from "./explainTopics";
import { EMPTY_SETUP } from "./explainTypes";
import type { ConversationAvailability, StartConversationInput } from "./conversation";

const state = vi.hoisted(() => ({
  availability: { ok: true } as ConversationAvailability,
  start: vi.fn<(input: StartConversationInput) => Promise<void>>(),
  availabilityKeys: [] as Array<string | undefined>,
  // Settings shows `viewed`; the conversation opens on `conversation`.
  viewed: null as string | null,
  conversation: null as string | null,
}));

vi.mock(import("../SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useOptionalSettingsScope: (() =>
    state.viewed === null ? null : { environment: { environmentId: state.viewed } }) as never,
}));

// Each environment has its own providers, so the test can tell whose facts were sent.
vi.mock(import("./explainFacts"), () => ({
  useConversationEnvironmentId: () => state.conversation as never,
  useSetupSnapshot: ((environmentId: string, _resolve: unknown, otherMachineViewed = false) => ({
    ...EMPTY_SETUP,
    ...(otherMachineViewed ? { otherMachineViewed: true } : {}),
    providers: [
      {
        name: environmentId === "laptop" ? "Claude on the laptop" : "Codex on the server",
        driver: "x",
        enabled: true,
        state: "Ready",
        plan: null,
      },
    ],
  })) as never,
}));

vi.mock(import("./conversation"), async (original) => ({
  ...(await original()),
  useConversationAvailability: (topicKey?: string) => {
    state.availabilityKeys.push(topicKey);
    return state.availability;
  },
  useStartConversation: () => state.start,
}));

const open = async (topic: Parameters<typeof ExplainControl>[0]["topic"]) => {
  const screen = await render(
    <div className="p-6">
      <ExplainControl topic={topic} />
    </div>,
    { router: "/settings/providers" },
  );
  await userEvent.click(page.getByRole("button", { name: "What is this?" }));
  return screen;
};

describe("the Explain control", () => {
  it("answers what it is and whether most people need it first, with the action under it, and the detail folded", async () => {
    state.availability = { ok: true };
    await using _screen = await open("usage-providers");
    const popup = document.querySelector<HTMLElement>('[data-explain-popup="usage-providers"]')!;
    await expect.element(popup).toBeVisible();
    const verdict = popup.querySelector<HTMLElement>("[data-explain-verdict]")!;
    expect(popup.textContent).toContain(
      "Usage providers show how much of your AI subscriptions is left",
    );
    expect(verdict.textContent).toContain("Most people do not need this");
    const ask = page.getByRole("button", { name: "Ask One about this" });
    await expect.element(ask).toBeEnabled();
    // Order: sentence, verdict, then the action; and the action is in view without scrolling.
    const asked = ask.element().getBoundingClientRect();
    expect(asked.top).toBeGreaterThanOrEqual(verdict.getBoundingClientRect().bottom);
    expect(asked.bottom).toBeLessThanOrEqual(window.innerHeight);
    // The detail is folded until asked for, and its words stay out of the first glance.
    expect(popup.querySelector("[data-explain-detail]")).toBeNull();
    expect(popup.textContent).not.toContain("management key");
    await userEvent.click(page.getByRole("button", { name: "More detail" }));
    const detail = popup.querySelector<HTMLElement>("[data-explain-detail]")!;
    for (const text of ["Use it when", "Skip it when", "You will need", "Hub", "HTTP source"]) {
      expect(detail.textContent, text).toContain(text);
    }
    const docs = page.getByRole("link", { name: "Read the docs" }).element() as HTMLAnchorElement;
    expect(docs.href).toContain("docs/user/usage.md#track-subscription-limits");
  });

  it("makes Ask One the one filled control and the docs a quiet link, and puts focus on Ask when it works", async () => {
    state.availability = { ok: true };
    await using _screen = await open("usage-providers");
    const ask = page.getByRole("button", { name: "Ask One about this" });
    await expect.element(ask).toHaveFocus();
    const docs = page.getByRole("link", { name: "Read the docs" }).element() as HTMLElement;
    expect(
      document
        .querySelector("[data-explain-popup]")!
        .querySelectorAll("button:not([aria-expanded])"),
    ).toHaveLength(1);
    expect(getComputedStyle(docs).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(docs).textDecorationLine).toContain("underline");
    expect(getComputedStyle(ask.element()).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("keeps the panel within 360 px and within the window, scrolling inside when the detail is open", async () => {
    state.availability = { ok: true };
    await using _screen = await open("usage-providers");
    await userEvent.click(page.getByRole("button", { name: "More detail" }));
    const popup = document.querySelector<HTMLElement>('[data-slot="popover-popup"]')!;
    const box = popup.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(360);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it("opens from the keyboard, moves focus into the popup, and returns it to the control on Escape", async () => {
    await using _screen = await render(
      <div className="p-6">
        <ExplainControl topic="archive" />
      </div>,
      { router: "/settings/archived" },
    );
    const trigger = page.getByRole("button", { name: "What is this?" });
    (trigger.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("button", { name: "Ask One about this" })).toBeVisible();
    expect(document.querySelector("[data-explain-popup]")!.contains(document.activeElement)).toBe(
      true,
    );

    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
    expect(document.querySelector("[data-explain-popup]")).toBeNull();
  });

  it("sends the topic's question as the visible message and keeps the notes and setup facts out of it", async () => {
    state.availability = { ok: true };
    state.start.mockReset().mockResolvedValue(undefined);
    await using _screen = await open("usage-hub");
    await userEvent.click(page.getByRole("button", { name: "Ask One about this" }));

    expect(state.start).toHaveBeenCalledOnce();
    const input = state.start.mock.calls[0]![0];
    expect(input.visibleText).toBe("What is a hub, and should I add one?");
    // The person reads only their own question; the model also gets the notes and the facts.
    expect(input.visibleText).not.toContain("CLIProxyAPI");
    expect(input.hiddenContext).toContain(explainTopic("usage-hub").notes);
    expect(input.hiddenContext).toContain("No usage source (hub or HTTP source) is set up.");
    expect(input.hiddenContext).toContain("Never invent a feature");
    expect(input.returnTo?.href).toContain("/settings/providers");
    expect(input.returnTo?.label).toBe("Providers");
    // The topic id is the key its thread is reopened under, for the button and for the start.
    expect(input.topicKey).toBe("usage-hub");
    expect(state.availabilityKeys).toContain("usage-hub");
  });

  it("explains with Ask One turned off, and says in words why, when no provider is connected", async () => {
    state.availability = { ok: false, reason: "Connect an AI provider to ask One." };
    await using _screen = await open("text-generators");
    const popup = document.querySelector<HTMLElement>('[data-explain-popup="text-generators"]')!;
    await expect.element(popup).toBeVisible();
    expect(popup.textContent).toContain("A text generator is an AI service that only writes text");
    const ask = page.getByRole("button", { name: "Ask One about this" });
    await expect.element(ask).toBeDisabled();
    const reason = [...popup.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Connect an AI provider to ask One."),
    )!;
    expect(reason.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(ask.element().getAttribute("aria-describedby")).toBe(reason.id);
    // Focus is on the panel, not on the docs link or the disabled button.
    const docsLink = page.getByRole("link", { name: "Read the docs" }).element();
    expect(document.activeElement).not.toBe(docsLink);
    expect(popup.closest('[data-slot="popover-popup"]')!.contains(document.activeElement)).toBe(
      true,
    );
    expect(state.start).not.toHaveBeenCalled();
  });

  it("keeps the person in Settings with the reason on screen when the conversation cannot open", async () => {
    state.availability = { ok: true };
    state.start.mockReset().mockRejectedValue(new Error("The thread could not be created."));
    await using _screen = await open("providers");
    await userEvent.click(page.getByRole("button", { name: "Ask One about this" }));
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("The thread could not be created.");
    // The popover stays, and asking again is possible.
    await expect.element(page.getByRole("button", { name: "Ask One about this" })).toBeEnabled();
  });

  it("sits beside a row's title when the row names a topic, as a glyph with the same accessible name", async () => {
    state.availability = { ok: true };
    await using screen = await render(
      <div data-app-modal="" className="w-[720px]">
        <SettingsRow title="Guest links" explain="guest-links" />
      </div>,
      { router: "/settings/labs" },
    );
    const title = screen.container.querySelector<HTMLElement>("[data-settings-row-title]")!;
    const trigger = page.getByRole("button", { name: "What is this?" });
    await expect.element(trigger).toBeVisible();
    expect(trigger.element().textContent).toBe("");
    // After the title, on its line.
    expect(trigger.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
      title.getBoundingClientRect().right,
    );
    await userEvent.click(trigger);
    const popup = document.querySelector<HTMLElement>('[data-explain-popup="guest-links"]')!;
    expect(popup.textContent).toContain("A guest link lets one person follow a single thread");
    expect(popup.textContent).toContain("Beta.");
  });

  it("tells the model about the machine the conversation opens on, and says so when Settings showed another one", async () => {
    state.availability = { ok: true };
    state.viewed = "server";
    state.conversation = "laptop";
    try {
      state.start.mockResolvedValue(undefined);
      await using _screen = await open("usage-providers");
      await userEvent.click(page.getByRole("button", { name: "Ask One about this" }));
      const input = state.start.mock.lastCall![0];
      expect(input.hiddenContext).toContain("Claude on the laptop");
      expect(input.hiddenContext).not.toContain("Codex on the server");
      expect(input.hiddenContext).toContain("looking at Settings for another machine");
    } finally {
      state.viewed = null;
      state.conversation = null;
    }
  });

  it("sends no other-machine line when Settings shows the machine the conversation runs on", async () => {
    state.availability = { ok: true };
    state.viewed = "laptop";
    state.conversation = "laptop";
    try {
      state.start.mockResolvedValue(undefined);
      await using _screen = await open("usage-providers");
      await userEvent.click(page.getByRole("button", { name: "Ask One about this" }));
      const input = state.start.mock.lastCall![0];
      expect(input.hiddenContext).toContain("Claude on the laptop");
      expect(input.hiddenContext).not.toContain("another machine");
    } finally {
      state.viewed = null;
      state.conversation = null;
    }
  });

  it("sends the places the answer can open, with translated labels and in-app addresses", async () => {
    state.availability = { ok: true };
    state.start.mockReset().mockResolvedValue(undefined);
    await using _screen = await open("usage-hub");
    await userEvent.click(page.getByRole("button", { name: "Ask One about this" }));
    const input = state.start.mock.lastCall![0] as StartConversationInput & {
      actions?: ReadonlyArray<{ label: string; href: string }>;
    };
    expect(input.actions).toContainEqual({
      label: "Add a hub",
      href: "/settings/providers?action=add-hub",
    });
    expect(input.actions!.every((action) => action.href.startsWith("/"))).toBe(true);
  });

  it("says Continue with One when asking will reopen the topic's earlier thread", async () => {
    state.availability = { ok: true, reopens: true } as ConversationAvailability;
    try {
      await using _screen = await open("usage-hub");
      await expect.element(page.getByRole("button", { name: "Continue with One" })).toBeEnabled();
      expect(page.getByRole("button", { name: "Ask One about this" }).query()).toBeNull();
    } finally {
      state.availability = { ok: true };
    }
  });
});
