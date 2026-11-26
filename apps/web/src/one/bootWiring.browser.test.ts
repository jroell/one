import indexHtml from "../../index.html?raw";
import { BUILT_IN_THEMES, getThemeColorsForAppearance } from "@t3tools/shared/themePalettes";
import { expect, it, vi } from "vite-plus/test";

const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
const scripts = [...parsed.querySelectorAll("script:not([src])")].map(
  (node) => node.textContent ?? "",
);
const themeScript = scripts.find((text) => text.includes("SPLASH_COLORS")) ?? "";
const ringScript = scripts.find((text) => text.includes("ringTintTable")) ?? "";

/** Runs the boot screen's own scripts for a stored theme and mode, and clears everything after. */
function bootScreen(theme: string | null, mode: "dark" | "light") {
  const html = document.documentElement;
  const styles = [...parsed.querySelectorAll("style")].map((source) => {
    const style = document.createElement("style");
    style.textContent = source.textContent;
    document.head.append(style);
    return style;
  });
  const host = document.createElement("div");
  host.innerHTML = parsed.querySelector("#boot-shell")!.outerHTML;
  document.body.append(host);
  if (theme === null) window.localStorage.removeItem("t3code:theme");
  else window.localStorage.setItem("t3code:theme", theme);
  window.localStorage.setItem("t3code:theme-appearance-mode", mode);
  new Function(themeScript)();
  new Function(ringScript)();
  const card = host.querySelector<HTMLElement>("#boot-shell-card")!;
  return {
    card,
    logo: host.querySelector<SVGElement>("#boot-shell-logo")!,
    images: [...host.querySelectorAll<HTMLImageElement>(".boot-ring-image")],
    [Symbol.dispose]: () => {
      host.remove();
      for (const style of styles) style.remove();
      window.localStorage.removeItem("t3code:theme");
      window.localStorage.removeItem("t3code:theme-appearance-mode");
      html.removeAttribute("style");
      html.classList.remove("dark");
      delete html.dataset.themeId;
      delete html.dataset.themeSelected;
    },
  };
}

const shown = (element: Element) => getComputedStyle(element).display !== "none";

it.each(["ocean", "ember", "grove"] as const)(
  "a %s boot shows the vector ring in its action color at once and swaps to the recolored picture when it is ready",
  async (id) => {
    using screen = bootScreen(id, "dark");
    const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === id)!;
    // The app's ring takes the action color (--one-brand), so the boot ring must take the same.
    expect(getComputedStyle(screen.card).getPropertyValue("--boot-ring-mid").trim()).toBe(
      getThemeColorsForAppearance(theme, "dark")?.messageAction,
    );
    expect(shown(screen.logo)).toBe(true);
    expect(screen.images.some(shown)).toBe(false);

    await vi.waitFor(() => expect(screen.card.dataset.ringTinted).toBeDefined(), { timeout: 8000 });
    expect(shown(screen.logo)).toBe(false);
    const picture = screen.images.find(shown);
    expect(picture?.src.startsWith("data:image/png")).toBe(true);
  },
);

it("a boot with no chosen theme shows the gold picture at once and never the vector", () => {
  using screen = bootScreen(null, "dark");
  expect(shown(screen.logo)).toBe(false);
  expect(screen.images.filter(shown)).toHaveLength(1);
  expect(screen.card.dataset.ringTinted).toBeUndefined();
});
