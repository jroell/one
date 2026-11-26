import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render, stubGlobal } from "../../../test/render";
import { OpenSourceLicensesPanel } from "./OpenSourceLicenses";

describe("open source licenses while the manifest loads", () => {
  it("shows no loading sentence, holds the list's space, and draws faint rows only after 250 ms", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    using _fetch = stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      (input instanceof Request ? input.url : String(input)).endsWith("/third-party-licenses.json")
        ? new Promise<Response>(() => {})
        : realFetch(input, init),
    );
    await using screen = await render(<OpenSourceLicensesPanel />, {
      router: "/settings/open-source-licenses",
    });
    const outline = await vi.waitFor(() => {
      const found = screen.container.querySelector<HTMLElement>('[role="status"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(screen.container.textContent).not.toContain("Loading open-source notices…");
    // 14 rows at the real row height (36 px), so the loaded list does not push anything.
    expect(outline.getBoundingClientRect().height).toBeGreaterThanOrEqual(14 * 36);
    const late = outline.querySelector<HTMLElement>(".settings-late")!;
    expect(getComputedStyle(late).animationDelay).toBe("0.25s");
    expect(getComputedStyle(late).opacity).toBe("0");
  });
});
