import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
  useHasSecretProvidersEnvironment: () => false,
}));

it("scrolls the active section into the rail's visible box when Settings opens on a late page", async () => {
  await page.viewport(1280, 800);
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:320px;width:240px";
  await using _screen = await render(
    <SidebarProvider defaultOpen className="h-80 min-h-0">
      <SettingsSidebarNav pathname="/settings/about" />
    </SidebarProvider>,
    { container, router: "/settings/about" },
  );

  const active = page.getByRole("button", { name: "About" }).element();
  const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
  expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  await vi.waitFor(() => {
    const box = active.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(frame.top);
    expect(box.bottom).toBeLessThanOrEqual(frame.bottom);
  });
});
