import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
import { GTProvider } from "gt-react";

import "~/index.css";

import fr from "~/i18n/translations/fr.json";
import { render } from "../../../test/render";
import { ChatHeader } from "./ChatHeader";

const project = {
  id: ProjectId.make("project"),
  environmentId: EnvironmentId.make("environment"),
  title: "acme-server",
  workspaceRoot: "/work/acme-server",
  repositoryIdentity: null,
  defaultModelSelection: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  scripts: [],
};

it("a phone header in a translated language gives the title the whole row and drops the project crumb", async () => {
  await page.viewport(390, 800);
  await using screen = await render(
    <GTProvider
      locale="fr"
      translations={{
        fr: Object.fromEntries(Object.entries(fr).map(([hash, text]) => [hash, String(text)])),
      }}
    >
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make("thread")}
        activeThreadTitle="Fix login redirect"
        isServerThread
        activeProject={project}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
        onNewThreadInProject={() => {}}
      />
    </GTProvider>,
    { router: false },
  );

  const crumbs = screen.getByRole("navigation", { name: "Fil d’Ariane du fil" });
  await expect.element(crumbs).toBeVisible();
  await expect.element(screen.getByText("Fix login redirect")).toBeVisible();
  const projectCrumb = screen.container.querySelector(
    "[data-one-header-crumbs] nav > ol > li:first-child",
  );
  expect(projectCrumb).not.toBeNull();
  expect(getComputedStyle(projectCrumb as Element).display).toBe("none");
});
