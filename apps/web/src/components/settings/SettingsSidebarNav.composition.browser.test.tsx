import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { AppRouteModal } from "../AppRouteModal";
import { SidebarProvider } from "../ui/sidebar";
import {
  SettingsSearchEmptyState,
  SettingsSearchProvider,
  useClearNoMatchSearchOnEscape,
  useSettingsSearchHasNoResults,
} from "./SettingsSearchContext";
import { SettingsBreadcrumb } from "./SettingsBreadcrumb";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { settingsNavGroups, SETTINGS_SECTION_LABELS } from "./settingsSearch";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [
    { id: "theme", title: "Theme", to: "/settings/appearance" },
  ],
  useHasSecretProvidersEnvironment: () => false,
}));
vi.mock("../chat/GlobalVoiceInputIndicator", () => ({ GlobalVoiceInputIndicator: () => null }));

it("ignores composing keys in the search", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });
  await search.fill("theme");
  await expect.element(page.getByRole("option", { name: /Theme/ })).toBeVisible();

  for (const composition of [
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
    { key: "Escape", isComposing: true, keyCode: 27 },
    { key: "Escape", isComposing: false, keyCode: 229 },
    { key: "ArrowDown", isComposing: true, keyCode: 40 },
    { key: "ArrowUp", isComposing: true, keyCode: 38 },
  ]) {
    const event = new KeyboardEvent("keydown", { ...composition, bubbles: true, cancelable: true });
    await act(() => search.element().dispatchEvent(event));
    expect(event.defaultPrevented, JSON.stringify(composition)).toBe(false);
    expect(screen.router?.state.location.pathname).toBe("/settings/general");
    await expect.element(search).toHaveValue("theme");
  }

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/settings/appearance"),
  );
});

it("Esc clears a search of spaces and a held Esc keeps Settings open", async () => {
  await using _screen = await render(
    <AppRouteModal label="Settings">
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/general" />
      </SidebarProvider>
    </AppRouteModal>,
    { router: "/settings/general" },
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  const search = page.getByRole("combobox", { name: "Search settings" });
  await expect.element(settings).toHaveFocus();

  for (const text of ["theme", "   "]) {
    await search.fill(text);
    await userEvent.keyboard("{Escape}");
    await expect.element(search).toHaveValue("");
    await expect.element(search).toHaveFocus();
    await act(() =>
      search.element().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          repeat: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect.element(settings).toHaveAttribute("data-open");
  }

  await userEvent.keyboard("{Escape}");
  await expect.element(settings).not.toBeInTheDocument();
});

function renderNav() {
  return render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
}

it("opens search from the physical Slash and F keys on non-US layouts", async () => {
  await using _screen = await renderNav();
  const search = page.getByRole("combobox", { name: "Search settings" });

  for (const { init, opens } of [
    { init: { key: "/", code: "Digit7", shiftKey: true }, opens: true }, // German Shift+7
    { init: { key: ".", code: "Slash" }, opens: true }, // Russian Slash key
    { init: { key: "а", code: "KeyF", ctrlKey: true }, opens: true }, // Russian Ctrl+F
    { init: { key: "?", code: "Slash", shiftKey: true }, opens: false },
  ]) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    await act(() => document.body.dispatchEvent(event));
    expect(event.defaultPrevented, JSON.stringify(init)).toBe(opens);
    if (opens) await expect.element(search).toHaveFocus();
  }
});

it("moves Tab through every settings section", async () => {
  await page.viewport(1280, 800);
  await using _screen = await renderNav();
  await userEvent.click(page.getByRole("combobox", { name: "Search settings" }));

  const sections = settingsNavGroups(false)
    .flatMap((group) => group.paths)
    .map((to) => SETTINGS_SECTION_LABELS[to]);
  const tabbed: string[] = [];
  for (let step = 0; step < sections.length; step += 1) {
    await userEvent.tab();
    const section = document.activeElement?.closest("[data-settings-section]");
    if (!section) break;
    tabbed.push(section.textContent ?? "");
  }
  expect(tabbed).toEqual(sections);
});

it.each([1280, 390])("names each group by a heading outside it at %ipx wide", async (width) => {
  await page.viewport(width, 800);
  await using _screen = await renderNav();

  for (const name of ["Agents", "Code", "Connections"]) {
    const heading = page.getByRole("heading", { name, level: 3 });
    await expect.element(heading).toBeInTheDocument();
    const group = page.getByRole("group", { name }).element();
    expect(group.getAttribute("aria-labelledby")).toBe(heading.element().id);
    expect(group.contains(heading.element()), `the ${name} heading is inside its group`).toBe(
      false,
    );
  }
  const groups = page.getByRole("group").elements();
  expect(groups).toHaveLength(settingsNavGroups(false).length);
  for (const group of groups) {
    const first = group.querySelector("[data-settings-section]")?.textContent;
    const heading = document.getElementById(group.getAttribute("aria-labelledby") ?? "");
    expect(heading?.tagName, `the group starting at ${first} has no heading`).toBe("H3");
  }
  expect(page.getByRole("tree").query()).toBeNull();
});

function SettingsPaneStandIn() {
  const hasNoResults = useSettingsSearchHasNoResults();
  return hasNoResults ? <SettingsSearchEmptyState /> : <p>Settings page</p>;
}

it("replaces the page with an empty state naming the query until the search is cleared", async () => {
  await using _screen = await render(
    <SettingsSearchProvider>
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/general" />
      </SidebarProvider>
      <SettingsPaneStandIn />
    </SettingsSearchProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });
  await expect.element(page.getByText("Settings page")).toBeVisible();

  await search.fill("zzzxx");
  await expect.element(page.getByText("No settings match “zzzxx”")).toBeVisible();
  expect(page.getByText("Settings page").query()).toBeNull();

  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect.element(page.getByText("Settings page")).toBeVisible();
  await expect.element(search).toHaveValue("");
  await expect.element(search).toHaveFocus();
});

it("drops a search with no matches when another settings page opens, so that page is usable", async () => {
  await using screen = await render(
    <SettingsSearchProvider>
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/general" />
      </SidebarProvider>
      <SettingsPaneStandIn />
    </SettingsSearchProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });

  await search.fill("zzzxx");
  await expect.element(page.getByText("No settings match “zzzxx”")).toBeVisible();

  await act(() => screen.router?.navigate({ to: "/settings/appearance" }));
  await expect.element(page.getByText("Settings page")).toBeVisible();
  await expect.element(search).toHaveValue("");
});

it("drops a search with no matches when only the URL search parameters change, without a render warning", async () => {
  await using screen = await render(
    <SettingsSearchProvider>
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/general" />
      </SidebarProvider>
      <SettingsPaneStandIn />
    </SettingsSearchProvider>,
    { router: "/settings/general?project=a" },
  );
  using errors = vi.spyOn(console, "error");
  const search = page.getByRole("combobox", { name: "Search settings" });

  await search.fill("zzzxx");
  await expect.element(page.getByText("No settings match “zzzxx”")).toBeVisible();

  await act(() =>
    screen.router?.navigate({ to: "/settings/general", search: { project: "b" } as never }),
  );
  await expect.element(page.getByText("Settings page")).toBeVisible();
  await expect.element(search).toHaveValue("");
  expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
    "Cannot update a component",
  );
});

it("keeps a search that still has matches when another settings page opens", async () => {
  await using screen = await render(
    <SettingsSearchProvider>
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/general" />
      </SidebarProvider>
      <SettingsPaneStandIn />
    </SettingsSearchProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });

  await search.fill("theme");
  await act(() => screen.router?.navigate({ to: "/settings/appearance" }));
  await expect.element(page.getByText("Settings page")).toBeVisible();
  await expect.element(search).toHaveValue("theme");
});

function SettingsModalStandIn() {
  const onEscape = useClearNoMatchSearchOnEscape();
  return (
    <AppRouteModal label="Settings" onEscape={onEscape}>
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/general" />
      </SidebarProvider>
      <SettingsPaneStandIn />
    </AppRouteModal>
  );
}

it("Esc on Clear settings search clears the search and keeps Settings open until the next Esc", async () => {
  await using _screen = await render(
    <SettingsSearchProvider>
      <SettingsModalStandIn />
    </SettingsSearchProvider>,
    { router: "/settings/general" },
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  const search = page.getByRole("combobox", { name: "Search settings" });
  const clear = page.getByRole("button", { name: "Clear settings search" });

  await search.fill("zzzxx");
  await act(() => clear.element().focus());
  await expect.element(clear).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(search).toHaveValue("");
  await expect.element(settings).toHaveAttribute("data-open");

  await userEvent.keyboard("{Escape}");
  await expect.element(settings).not.toBeInTheDocument();
});

it("highlights the section a detail page lives under and names it in the breadcrumb", async () => {
  await using _screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsBreadcrumb pathname="/settings/diagnostics" />
      <SettingsSidebarNav pathname="/settings/diagnostics" />
    </SidebarProvider>,
    { router: "/settings/diagnostics" },
  );

  await expect
    .element(page.getByRole("button", { name: "Maintenance" }))
    .toHaveAttribute("aria-current", "page");
  const crumbs = page
    .getByRole("navigation", { name: "Settings breadcrumb" })
    .getByRole("listitem")
    .elements()
    .filter((item) => item.getAttribute("aria-hidden") !== "true")
    .map((item) => item.textContent);
  expect(crumbs).toEqual(["Settings", "Maintenance", "Diagnostics"]);
});

it("spells the snapshots section in one case in the rail", async () => {
  await using _screen = await renderNav();
  await expect.element(page.getByRole("button", { name: "Snapshots", exact: true })).toBeVisible();
});

it("scrolls the open section into view after the first paint, not while the sheet is mounting", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  try {
    await using screen = await render(
      <SidebarProvider defaultOpen>
        <SettingsSidebarNav pathname="/settings/maintenance" />
      </SidebarProvider>,
      { router: "/settings/maintenance" },
    );
    const scrolledHere = () =>
      scroll.mock.contexts.some((element) => screen.container.contains(element as Node));
    // Scrolling forces a layout; done in the mounting commit it would lengthen the sheet's opening.
    expect(scrolledHere()).toBe(false);
    // The scroll waits for an animation frame, which a loaded machine can delay past the default 1 s.
    await vi.waitFor(() => expect(scrolledHere()).toBe(true), { timeout: 10_000 });
  } finally {
    scroll.mockRestore();
  }
});

it("loads a page's route as the pointer reaches its rail item, and every page once the sheet is idle", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  const preload = vi.spyOn(screen.router!, "preloadRoute").mockResolvedValue(undefined);
  await userEvent.hover(
    page.getByRole("button", { name: SETTINGS_SECTION_LABELS["/settings/appearance"] }),
  );
  expect(preload).toHaveBeenCalledWith({ to: "/settings/appearance" });
  // About leads to the licenses, so its rail item also warms that page.
  await userEvent.hover(
    page.getByRole("button", { name: SETTINGS_SECTION_LABELS["/settings/about"] }),
  );
  expect(preload).toHaveBeenCalledWith({ to: "/settings/open-source-licenses" });

  // Idle: each page's route is asked for, one per idle slice, with no hover at all.
  const pages = settingsNavGroups(false).flatMap((group) => group.paths);
  await vi.waitFor(() => {
    const asked = new Set(preload.mock.calls.map(([options]) => options.to));
    expect(pages.every((path) => asked.has(path))).toBe(true);
  });
});
