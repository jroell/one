import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { SettingsPageHeader } from "./SettingsPageHeader";

vi.mock(import("./explain/conversation"), async (original) => ({
  ...(await original()),
  useConversationAvailability: () => ({ ok: true }) as const,
  useStartConversation: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock(import("./explain/explainFacts"), () => ({
  useConversationEnvironmentId: () => null as never,
  useSetupSnapshot: (() => ({ providers: [], usageSources: [], textGenerators: [] })) as never,
}));

it("the Voice settings header explains that you can talk to One and hear its answers", async () => {
  await using screen = await render(<SettingsPageHeader />, { router: "/settings/voice" });
  await expect.element(screen.getByText("Talk to One and hear answers read back.")).toBeVisible();
});

describe("the page-level What is this?", () => {
  it.each([
    ["/settings/chat", "chat-settings"],
    ["/settings/threads", "threads-settings"],
    ["/settings/labs", "labs"],
    ["/settings/source-control", "source-control"],
    ["/settings/worktrees", "worktrees"],
    ["/settings/devices", "devices"],
    ["/settings/maintenance", "maintenance"],
    ["/settings/keybindings", "keyboard-shortcuts"],
  ])("sits under the subtitle of %s and opens that page's own explanation", async (path, topic) => {
    await using _screen = await render(<SettingsPageHeader />, { router: path });
    const trigger = document.querySelector<HTMLElement>(
      `[data-settings-page-explain] [data-explain-trigger="${topic}"]`,
    );
    expect(trigger).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "What is this?" }));
    expect(document.querySelector(`[data-explain-popup="${topic}"]`)).not.toBeNull();
  });

  it("is absent on a page whose rows explain themselves", async () => {
    await using _screen = await render(<SettingsPageHeader />, { router: "/settings/appearance" });
    expect(document.querySelector("[data-settings-page-explain]")).toBeNull();
  });
});
