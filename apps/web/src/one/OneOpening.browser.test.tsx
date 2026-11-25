import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import "~/index.css";

import { act, render } from "../../test/render";
import { registerCommands } from "../shortcuts/dispatcher";
import { OneOpening } from "./OneOpening";
import { OPENING_SEEN_KEY, replayOpening, setOpeningPreferences } from "./openingPreferences";

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

// Reduced motion is the one setting that skips the opening, so say it is off instead of
// relying on the browser the test happens to run in.
function motionAllowed(): Disposable {
  const original = window.matchMedia.bind(window);
  return vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? "not all" : query),
    );
}

/**
 * The cover, located by element: once it starts to leave it is hidden from the accessibility tree,
 * so a role query would stop finding it.
 */
async function findCover() {
  await expect.element(page.getByRole("dialog", { name: "One is opening" })).toBeInTheDocument();
  const element = document.querySelector<HTMLElement>(".one-opening");
  if (!element) throw new Error("Expected the opening cover to be on the page");
  return page.elementLocator(element);
}

describe("the opening on a fresh session", () => {
  it("takes the first key to lift the cover without running the command bound to it, and gives the app the next click", async () => {
    // The shared setup marks the opening as seen; a fresh session has not.
    window.sessionStorage.removeItem(OPENING_SEEN_KEY);
    setOpeningPreferences({ animation: true, sound: false });
    onTestFinished(() => setOpeningPreferences({ sound: true }));
    using _motion = motionAllowed();
    const app = mountAppRoot();
    const keysTheAppSaw: string[] = [];
    const record = (event: KeyboardEvent) => keysTheAppSaw.push(event.key);
    window.addEventListener("keydown", record);
    onTestFinished(() => window.removeEventListener("keydown", record));
    // The dispatcher listens before the opening mounts, as it does at launch, and "d" is a bare
    // key bound to a capture-scope command.
    const openedDiff = vi.fn((event: KeyboardEvent) => event.preventDefault());
    using _command = {
      [Symbol.dispose]: registerCommands(
        { "diff.toggle": openedDiff },
        {
          capture: true,
          keybindings: () =>
            compileResolvedKeybindingsConfig([{ key: "d", command: "diff.toggle" }]),
        },
      ),
    };

    await using _opening = await render(<OneOpening />, { router: false });
    const cover = await findCover();
    expect(app.root.inert).toBe(true);
    expect(window.sessionStorage.getItem(OPENING_SEEN_KEY)).toBe("1");

    await userEvent.keyboard("d");
    // The app is usable as soon as the cover starts to leave, and the key went no further.
    await expect.element(cover).toHaveAttribute("data-phase", "leaving");
    expect(app.root.inert).toBe(false);
    expect(openedDiff).not.toHaveBeenCalled();
    expect(keysTheAppSaw).toEqual([]);
    expect(app.presses()).toBe(0);

    await expect.element(cover).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "New thread" }));
    expect(app.presses()).toBe(1);
    await userEvent.keyboard("d");
    expect(openedDiff).toHaveBeenCalledOnce();
    expect(keysTheAppSaw).toEqual(["d"]);
  });

  it("does not play again in a session that has seen it", async () => {
    window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    const app = mountAppRoot();
    await using _opening = await render(<OneOpening />, { router: false });
    expect(document.querySelector(".one-opening")).toBeNull();
    expect(app.root.inert).toBe(false);
  });

  it("turns the keyboard back on when it is removed while still playing", async () => {
    window.sessionStorage.removeItem(OPENING_SEEN_KEY);
    setOpeningPreferences({ animation: true, sound: false });
    onTestFinished(() => setOpeningPreferences({ sound: true }));
    const app = mountAppRoot();
    {
      await using _opening = await render(<OneOpening />, { router: false });
      await expect
        .element(page.getByRole("dialog", { name: "One is opening" }))
        .toBeInTheDocument();
      // The key dispatcher runs no command while this is set.
      expect(document.documentElement.dataset.oneOpening).toBe("");
    }
    expect(document.documentElement.dataset.oneOpening).toBeUndefined();
    expect(app.root.inert).toBe(false);
  });
});

/** A stand-in for the Settings dialog: a portal under `body`, outside `#root`. */
function mountSettingsDialog() {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Settings");
  const play = document.createElement("button");
  play.textContent = "Play it now";
  const other = document.createElement("button");
  other.textContent = "Reduce motion";
  dialog.append(play, other);
  document.body.append(dialog);
  onTestFinished(() => dialog.remove());
  return { dialog, play, other };
}

describe("a replay from Settings", () => {
  async function startReplay() {
    window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    setOpeningPreferences({ animation: true, sound: false });
    onTestFinished(() => setOpeningPreferences({ sound: true }));
    const settings = mountSettingsDialog();
    const app = mountAppRoot();
    const opening = await render(<OneOpening />, { router: false });
    onTestFinished(() => opening[Symbol.asyncDispose]());
    settings.play.focus();
    await act(() => replayOpening());
    return { settings, app, cover: await findCover() };
  }

  it("holds back the Settings dialog and anything portaled in while it plays, then releases only what it held", async () => {
    using _motion = motionAllowed();
    // Already inert before the opening starts, so it is not the opening's to release.
    const heldElsewhere = document.createElement("div");
    heldElsewhere.inert = true;
    document.body.append(heldElsewhere);
    onTestFinished(() => heldElsewhere.remove());
    const { settings, app } = await startReplay();
    expect(settings.dialog.inert).toBe(true);
    expect(app.root.inert).toBe(true);

    const toast = document.createElement("div");
    document.body.append(toast);
    onTestFinished(() => toast.remove());
    await Promise.resolve();
    expect(toast.inert).toBe(true);

    await userEvent.keyboard("x");
    expect(settings.dialog.inert).toBe(false);
    expect(app.root.inert).toBe(false);
    expect(toast.inert).toBe(false);
    expect(heldElsewhere.inert).toBe(true);
  });

  it("takes the cover out of the dialog tree and returns focus to the button the moment it starts to fade", async () => {
    using _motion = motionAllowed();
    const { settings, cover } = await startReplay();
    expect(document.activeElement).not.toBe(settings.play);
    await expect.element(cover).toHaveAttribute("aria-modal", "true");

    await userEvent.keyboard("x");

    await expect.element(cover).toHaveAttribute("data-phase", "leaving");
    await expect.element(cover).not.toHaveAttribute("aria-modal");
    await expect.element(cover).toHaveAttribute("aria-hidden", "true");
    expect(cover.element().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(settings.play);
  });

  it("does not pull focus back to the button when another control took it during the fade", async () => {
    using _motion = motionAllowed();
    const { settings, cover } = await startReplay();

    await userEvent.keyboard("x");
    await expect.element(cover).toHaveAttribute("data-phase", "leaving");
    settings.other.focus();
    await expect.element(cover).not.toBeInTheDocument();

    expect(document.activeElement).toBe(settings.other);
  });
});
