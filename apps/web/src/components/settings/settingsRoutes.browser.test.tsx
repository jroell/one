import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { getRouter } from "../../router";
import { Route as SettingsRoute } from "../../routes/_chat.settings";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsPageContainer } from "./settingsLayout";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
  useHasSecretProvidersEnvironment: () => false,
}));

/** The real settings layout's not-found handling, placed in a small tree beside two pages. */
function settingsTree(path: string) {
  const root = createRootRoute({ component: Outlet });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: Outlet,
    notFoundComponent: SettingsRoute.options.notFoundComponent!,
  });
  const general = createRoute({
    getParentRoute: () => settings,
    path: "/general",
    component: () => <p>General page</p>,
  });
  const diagnostics = createRoute({
    getParentRoute: () => settings,
    path: "/diagnostics",
    component: () => <p>Diagnostics page</p>,
  });
  return createRouter({
    routeTree: root.addChildren([settings.addChildren([general, diagnostics])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

describe("settings routes", () => {
  it("sends an address that is no settings page to General, and leaves alone one the router matches", async () => {
    await using unknown = await render(<RouterProvider router={settingsTree("/settings/nope")} />, {
      router: false,
    });
    await expect.element(unknown.getByText("General page")).toBeVisible();

    const mixedCase = settingsTree("/Settings/Diagnostics");
    await using matched = await render(<RouterProvider router={mixedCase} />, { router: false });
    await expect.element(matched.getByText("Diagnostics page")).toBeVisible();
    expect(mixedCase.state.location.pathname).toBe("/Settings/Diagnostics");
  });

  it("matches a mixed-case settings address to its page in the app's own route tree", () => {
    const router = getRouter(createMemoryHistory({ initialEntries: ["/"] }));
    const ids = (pathname: string) =>
      router.matchRoutes(pathname, {}).map((match) => match.routeId);

    expect(ids("/Settings/Diagnostics")).toContain("/_chat/settings/diagnostics");
    expect(ids("/settings/diagnostics/")).toContain("/_chat/settings/diagnostics");
    expect(ids("/settings/no-such-page")).not.toContain("/_chat/settings/diagnostics");
  });
});

/** The real settings layout (chrome, scope rules, redirects) around pages that only show their container. */
function realLayoutTree(path: string) {
  const root = createRootRoute({
    component: () => (
      <SidebarProvider defaultOpen>
        <Outlet />
      </SidebarProvider>
    ),
  });
  // The real layout reads its route by id, so the tree repeats the app's pathless "_chat" layout.
  const chat = createRoute({ getParentRoute: () => root, id: "_chat", component: Outlet });
  const settings = createRoute({
    getParentRoute: () => chat as AnyRoute,
    path: "/settings",
    component: SettingsRoute.options.component!,
    validateSearch: SettingsRoute.options.validateSearch!,
    search: SettingsRoute.options.search!,
    beforeLoad: SettingsRoute.options.beforeLoad!,
    notFoundComponent: SettingsRoute.options.notFoundComponent!,
  });
  const page = (name: string) => () => (
    <SettingsPageContainer>
      <p>{name} page body</p>
    </SettingsPageContainer>
  );
  const children = ["general", "diagnostics", "about", "projects"].map((name) =>
    createRoute({ getParentRoute: () => settings, path: `/${name}`, component: page(name) }),
  );
  return createRouter({
    routeTree: root.addChildren([chat.addChildren([settings.addChildren(children)])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

/** The settings modal renders in a portal, so the chrome is read from the document. */
async function chromeAt(path: string) {
  const router = realLayoutTree(path);
  await using _screen = await render(<RouterProvider router={router} />, { router: false });
  await expect.element(page.getByText(/page body/)).toBeVisible();
  const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
  return {
    router,
    chrome: {
      intro: text("[data-settings-page-title]"),
      restore: document.querySelector("[data-settings-restore]") !== null,
      scope: text("[data-settings-scope]"),
      crumb: text("[data-settings-header] nav"),
    },
    pathname: router.state.location.pathname,
  };
}

describe("settings chrome across address spellings", () => {
  it.each([
    ["/settings/general", ["/Settings/General", "/settings/general/", "/SETTINGS/GENERAL/"]],
    ["/settings/diagnostics", ["/Settings/Diagnostics", "/settings/diagnostics/"]],
    ["/settings/about", ["/Settings/About", "/settings/about/"]],
  ])(
    "shows %s's intro, restore action and scope bar for every spelling of the address",
    async (canonical, spellings) => {
      const expected = await chromeAt(canonical);
      expect(expected.chrome.intro).not.toBeNull();
      // General is the one page with the restore action, Diagnostics the one with a filter bar.
      if (canonical === "/settings/general") expect(expected.chrome.restore).toBe(true);
      if (canonical === "/settings/diagnostics") {
        // Its numbers come from one environment, so the bar must not offer all of them.
        expect(expected.chrome.scope).toContain("Showing");
        expect(expected.chrome.scope).not.toContain("All environments");
      }
      for (const spelling of spellings) {
        const variant = await chromeAt(spelling);
        expect(variant.chrome, spelling).toEqual(expected.chrome);
      }
    },
  );

  it("sends a bare or mixed-case /settings address to General", async () => {
    for (const path of ["/settings", "/Settings", "/settings/"]) {
      const result = await chromeAt(path);
      expect(result.pathname.toLowerCase(), path).toBe("/settings/general");
      expect(result.chrome.restore, path).toBe(true);
    }
  });
});
