import { expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { PierreEntryIcon } from "./PierreEntryIcon";

const PATHS = [
  "src/app.ts",
  "src/app.test.ts",
  "main.py",
  "styles.css",
  "package.json",
  "README.md",
  "main.rs",
  "main.go",
  "Dockerfile",
  "report.pdf",
  "notes.docx",
  "budget.xlsx",
  "deck.pptx",
  "clip.mp4",
  "photo.png",
  "AGENTS.md",
];

function appearance(scheme: "light" | "dark"): Disposable {
  const root = document.documentElement;
  const had = root.classList.contains("dark");
  root.classList.toggle("dark", scheme === "dark");
  root.style.colorScheme = scheme;
  return {
    [Symbol.dispose]: () => {
      root.classList.toggle("dark", had);
      root.style.colorScheme = "";
    },
  };
}

it.each(["light", "dark"] as const)(
  "every file and language icon draws in the one muted icon tone, with no colour of its own, in %s",
  async (scheme) => {
    using _scheme = appearance(scheme);
    await using screen = await render(
      <div>
        <span data-probe className="text-icon-muted" />
        {PATHS.map((path) => (
          <PierreEntryIcon key={path} pathValue={path} kind="file" />
        ))}
        <PierreEntryIcon pathValue="src" kind="directory" />
      </div>,
      { router: false },
    );
    const probe = getComputedStyle(screen.container.querySelector("[data-probe]")!).color;
    const icons = [...screen.container.querySelectorAll<SVGElement>("svg[data-pierre-icon]")];
    expect(icons.length).toBeGreaterThan(10);
    for (const icon of icons) {
      expect(icon.getAttribute("style"), icon.dataset.pierreIcon).toBeNull();
      expect(getComputedStyle(icon).color, icon.dataset.pierreIcon).toBe(probe);
    }
    // The sprite those icons reference holds no colour either: every shape takes currentColor.
    const sprite = document.getElementById("t3code-pierre-file-icon-sprite")!;
    expect(sprite.querySelectorAll("symbol").length).toBeGreaterThan(20);
    const coloured = [...sprite.querySelectorAll("*")].filter((node) => {
      const style = node.getAttribute("style") ?? "";
      const paint = ["fill", "stroke", "color"].map((name) => node.getAttribute(name) ?? "");
      return (
        /light-dark|#[0-9a-f]{3,8}|rgb|hsl/i.test(style) ||
        paint.some((value) => /^#|^rgb|^hsl/i.test(value))
      );
    });
    expect(coloured.map((node) => node.parentElement?.id ?? node.id)).toEqual([]);
  },
);
