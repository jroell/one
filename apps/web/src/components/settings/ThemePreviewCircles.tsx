import { useGT } from "gt-react";
import { MoonIcon, SunIcon } from "lucide-react";
import { STANDARD_THEME_PREVIEW_COLORS as SHARED_STANDARD_THEME_PREVIEW_COLORS } from "@t3tools/shared/themePreview";
import { cn } from "../../lib/utils";
import { ThemeWireframe } from "./ThemeWireframe";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getThemeColorsForMode,
  getThemeModes,
  type ThemeAppearance,
  type ThemeDefinition,
} from "../../themePalette";

const THEME_PREVIEW_ROLES = [
  "sidebar",
  "canvas",
  "surface",
  "accentSurface",
  "accent",
  "messageSurface",
  "messageAction",
] as const;
type ThemePreviewRole = (typeof THEME_PREVIEW_ROLES)[number];
type ThemeCardPreview = {
  mode: ThemeAppearance;
  colors: Readonly<Record<ThemePreviewRole, string>>;
};
export type ThemeCardDefinition = {
  id: string;
  label: string;
  previews: ReadonlyArray<ThemeCardPreview>;
};
export type ThemeMode = ThemeAppearance | "system";
export type ThemeCardPreviewColors = ThemeCardPreview["colors"];

/**
 * The default theme's tiles draw the app's own material: its base, raised and card surfaces and its
 * brand gold (the `--m-*` tokens in one-ui.css). The values are copied here because a tile for the
 * other mode cannot be read from the page; `ThemePreviewCircles.browser.test.tsx` resolves the
 * tokens in both modes and fails when these drift.
 */
export const STANDARD_TILE_MATERIAL = {
  light: {
    base: "#faf7f1",
    raised: "#fffaf0",
    card: "#fffbf2",
    floating: "#fbf8f0",
    brand: "#a88027",
  },
  dark: {
    base: "#0a0908",
    raised: "#17140f",
    card: "#17140f",
    floating: "#12100d",
    brand: "#d4af5a",
  },
} as const satisfies Record<ThemeAppearance, Record<string, string>>;

const standardTileColors = (mode: ThemeAppearance): Readonly<Record<ThemePreviewRole, string>> => {
  const material = STANDARD_TILE_MATERIAL[mode];
  return {
    ...SHARED_STANDARD_THEME_PREVIEW_COLORS[mode],
    sidebar: material.base,
    canvas: material.base,
    surface: material.raised,
    accentSurface: material.card,
    messageSurface: material.card,
    accent: material.brand,
    messageAction: material.brand,
  };
};

const STANDARD_THEME_PREVIEW_COLORS: Record<
  ThemeAppearance,
  Readonly<Record<ThemePreviewRole, string>>
> = { light: standardTileColors("light"), dark: standardTileColors("dark") };

export const STANDARD_THEME_CARDS: ReadonlyArray<ThemeCardDefinition> = [
  {
    id: "default",
    label: "One",
    previews: (["light", "dark"] as const).map((mode) => ({
      mode,
      colors: STANDARD_THEME_PREVIEW_COLORS[mode],
    })),
  },
];

export function previewColorsOf(
  card: ThemeCardDefinition,
  mode: ThemeAppearance,
): ThemeCardPreviewColors | null {
  return card.previews.find((preview) => preview.mode === mode)?.colors ?? null;
}

export function getThemeCardDefinition(theme: ThemeDefinition): ThemeCardDefinition {
  return {
    id: theme.id,
    label: theme.label,
    previews: getThemeModes(theme).map((mode) => {
      const colors = getThemeColorsForMode(theme, mode) ?? theme.colors;
      return {
        mode,
        colors: {
          sidebar: colors.sidebar,
          canvas: colors.canvas,
          surface: colors.surface,
          accentSurface: colors.accentSurface,
          accent: colors.accent,
          messageSurface: colors.messageSurface,
          messageAction: colors.messageAction,
        },
      };
    }),
  };
}

/** A theme drawn as the app: its sidebar, canvas, a surface, a message, a button, in its own colors. */
export function ThemePreviewMini({
  colors,
  size = "tile",
  className,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
  /** `tile` is the Appearance card preview; `row` is the same drawing at the size of a list row. */
  size?: "tile" | "row";
  className?: string;
}) {
  return (
    <ThemeWireframe
      className={cn(
        size === "row" ? "h-6 w-9 rounded-md" : "h-14 w-[5.25rem]",
        "shrink-0",
        className,
      )}
      panes={[{ colors }]}
    />
  );
}

export function ThemePreviewMinis({
  label,
  activeModes,
  onSelectMode,
  previews,
}: {
  label: string;
  activeModes: ReadonlyArray<ThemeMode>;
  onSelectMode: (mode: ThemeMode) => void;
  previews: ThemeCardDefinition["previews"];
}) {
  const gt = useGT();
  return (
    <div className="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
      {previews.map((preview) => {
        const mode = preview.mode;
        const isPicked = activeModes.includes(mode);
        return (
          <Tooltip key={mode}>
            <TooltipTrigger
              render={
                <button
                  aria-label={
                    mode === "light"
                      ? gt("Use {label} light mode", { label })
                      : gt("Use {label} dark mode", { label })
                  }
                  aria-pressed={isPicked}
                  className={cn(
                    "relative flex shrink-0 transform-gpu cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-5 focus-visible:outline-foreground/60",
                    isPicked && "hover:scale-100",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectMode(mode);
                  }}
                  type="button"
                >
                  <ThemePreviewMini colors={preview.colors} mode={mode} />
                  {isPicked ? (
                    <>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm"
                      >
                        {mode === "light" ? (
                          <SunIcon className="size-3" />
                        ) : (
                          <MoonIcon className="size-3" />
                        )}
                      </span>
                    </>
                  ) : null}
                </button>
              }
            />
            <TooltipPopup>
              {mode === "light" ? gt("Use for light mode only") : gt("Use for dark mode only")}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
