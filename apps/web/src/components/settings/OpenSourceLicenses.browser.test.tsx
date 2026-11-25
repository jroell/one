import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render, stubGlobal } from "../../../test/render";
import { AppRouteModal } from "../AppRouteModal";
import { OpenSourceLicensesPanel } from "./OpenSourceLicenses";

vi.mock("../chat/GlobalVoiceInputIndicator", () => ({ GlobalVoiceInputIndicator: () => null }));

it("Esc in the license search closes it without closing Settings", async () => {
  const entry = {
    bundles: ["web"],
    kind: "package",
    license: "MIT",
    name: "react",
    noticeText: "MIT License",
    sourceUrl: null,
    version: "19.0.0",
  };
  // The manifest is read once per page load, so every test in this file shares these entries.
  const pointer = { ...entry, name: "pointer-package", license: "SEE LICENSE IN README.md" };
  const dual = { ...entry, name: "dual-package", license: "(Apache-2.0 AND BSD-3-Clause)" };
  const realFetch = globalThis.fetch.bind(globalThis);
  using _fetch = stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    (input instanceof Request ? input.url : String(input)).endsWith("/third-party-licenses.json")
      ? Promise.resolve(Response.json({ schemaVersion: 1, entries: [entry, pointer, dual] }))
      : realFetch(input, init),
  );
  await using _screen = await render(
    <AppRouteModal label="Settings">
      <OpenSourceLicensesPanel />
    </AppRouteModal>,
    { router: "/settings/open-source-licenses" },
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  const search = page.getByRole("searchbox", { name: "Search open-source licenses" });
  await expect.element(search).toBeVisible();
  await search.fill("react");
  await expect.element(search).toHaveFocus();

  // Esc clears the query and keeps the field.
  await userEvent.keyboard("{Escape}");
  await expect.element(settings).toHaveAttribute("data-open");
  await expect.element(search).toHaveValue("");
  await expect.element(search).toHaveFocus();

  // Esc on the empty field hands focus to the dialog without closing it.
  await userEvent.keyboard("{Escape}");
  await expect.element(settings).toHaveAttribute("data-open");
  await expect.element(search).toBeVisible();
  await expect.element(settings).toHaveFocus();

  await userEvent.keyboard("{Escape}");

  await expect.element(settings).not.toBeInTheDocument();
});

it("lists a pointer license as a custom license and an expression without parentheses", async () => {
  await using screen = await render(<OpenSourceLicensesPanel />, {
    router: "/settings/open-source-licenses",
  });

  await expect.element(screen.getByText(/Custom \(see README\)/)).toBeVisible();
  await expect.element(screen.getByText(/Apache-2\.0 \+ BSD-3-Clause/)).toBeVisible();
  expect(screen.container.textContent).not.toContain("SEE LICENSE IN");
  expect(screen.container.textContent).not.toContain("(Apache-2.0 AND");
});
