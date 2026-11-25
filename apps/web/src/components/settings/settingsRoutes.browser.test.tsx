import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { getRouter } from "../../router";
import { Route as SettingsRoute } from "../../routes/_chat.settings";

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
