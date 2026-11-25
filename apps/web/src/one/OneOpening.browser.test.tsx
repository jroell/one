import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import "~/index.css";

import { render } from "../../test/render";
import { OneOpening } from "./OneOpening";
import { OPENING_SEEN_KEY, setOpeningPreferences } from "./openingPreferences";

/** A stand-in for the app: the opening makes `#root` inert while it covers it. */
function mountAppRoot() {
  const root = document.createElement("div");
  root.id = "root";
  const button = document.createElement("button");
  button.textContent = "New thread";
  let presses = 0;
  button.addEventListener("click", () => presses++);
  root.append(button);
  document.body.append(root);
  onTestFinished(() => root.remove());
  return { root, presses: () => presses };
}

describe("the opening on a fresh session", () => {
  it("takes the first key to lift the cover, and gives the app the next click", async () => {
    // The shared setup marks the opening as seen; a fresh session has not.
    window.sessionStorage.removeItem(OPENING_SEEN_KEY);
    setOpeningPreferences({ animation: true, sound: false });
    onTestFinished(() => setOpeningPreferences({ sound: true }));
    const app = mountAppRoot();
    const keysTheAppSaw: string[] = [];
    const record = (event: KeyboardEvent) => keysTheAppSaw.push(event.key);
    window.addEventListener("keydown", record);
    onTestFinished(() => window.removeEventListener("keydown", record));

    await using _opening = await render(<OneOpening />, { router: false });
    const cover = page.getByRole("dialog", { name: "One is opening" });
    await expect.element(cover).toBeInTheDocument();
    expect(app.root.inert).toBe(true);
    expect(window.sessionStorage.getItem(OPENING_SEEN_KEY)).toBe("1");

    await userEvent.keyboard("{Enter}");
    // The app is usable as soon as the cover starts to leave, and the key went no further.
    await expect.poll(() => app.root.inert).toBe(false);
    expect(keysTheAppSaw).toEqual([]);
    expect(app.presses()).toBe(0);

    await expect.element(cover).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "New thread" }));
    expect(app.presses()).toBe(1);
    await userEvent.keyboard("a");
    expect(keysTheAppSaw).toEqual(["a"]);
  });

  it("does not play again in a session that has seen it", async () => {
    window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    const app = mountAppRoot();
    await using _opening = await render(<OneOpening />, { router: false });
    expect(document.querySelector(".one-opening")).toBeNull();
    expect(app.root.inert).toBe(false);
  });
});
