import { expect, it } from "vite-plus/test";

import "~/index.css";

import { render, stubGlobal } from "../../../test/render";
import { OpenSourceLicensesPanel } from "./OpenSourceLicenses";

it("shows a long package name whole on a phone, with its license on the line under it", async () => {
  const entry = {
    bundles: ["web"],
    kind: "package",
    license: "Apache-2.0",
    name: "@betteroffice/fonts-cjk-extended-latin",
    noticeText: "Apache License",
    sourceUrl: null,
    version: "0.4.0",
  };
  const realFetch = globalThis.fetch.bind(globalThis);
  using _fetch = stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    (input instanceof Request ? input.url : String(input)).endsWith("/third-party-licenses.json")
      ? Promise.resolve(Response.json({ schemaVersion: 1, entries: [entry] }))
      : realFetch(input, init),
  );
  const phone = document.createElement("div");
  phone.style.width = "360px";
  await using screen = await render(<OpenSourceLicensesPanel />, {
    container: phone,
    router: "/settings/open-source-licenses",
  });

  await expect.poll(() => screen.container.querySelector("article")).not.toBeNull();
  const article = screen.container.querySelector("article")!;
  const name = [...article.querySelectorAll("span")].find(
    (span) => span.childElementCount === 0 && span.textContent?.startsWith("@betteroffice"),
  )!;
  const meta = [...article.querySelectorAll("span")].find(
    (span) => span.childElementCount === 0 && span.textContent?.startsWith("Apache-2.0"),
  )!;
  expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
  expect(meta.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    name.getBoundingClientRect().bottom - 1,
  );
});
