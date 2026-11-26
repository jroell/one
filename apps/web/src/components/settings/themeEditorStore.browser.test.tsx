import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useThemeEditorStore } from "./themeEditorStore";

const input = {
  editingThemeId: null,
  seedThemeId: null,
  seedName: null,
  initialAppearance: "dark",
} as const;

it("hands focus back to the control that opened the theme editor when the editor closes", async () => {
  await using _screen = await render(
    <div>
      <button type="button">Create theme</button>
      <input aria-label="Theme name" />
    </div>,
    { router: false },
  );
  const opener = page.getByRole("button", { name: "Create theme" });
  const field = page.getByRole("textbox", { name: "Theme name" });

  (opener.element() as HTMLElement).focus();
  useThemeEditorStore.getState().openThemeEditor(input);
  // The editor moves focus into itself while it is open, and its field goes away on close.
  (field.element() as HTMLElement).focus();
  (field.element() as HTMLElement).blur();
  useThemeEditorStore.getState().closeThemeEditor();

  await expect.element(opener).toHaveFocus();
});

it("leaves focus alone when the person has already moved it somewhere else", async () => {
  await using _screen = await render(
    <div>
      <button type="button">Create theme</button>
      <input aria-label="Theme name" />
    </div>,
    { router: false },
  );
  const opener = page.getByRole("button", { name: "Create theme" });
  const field = page.getByRole("textbox", { name: "Theme name" });

  (opener.element() as HTMLElement).focus();
  useThemeEditorStore.getState().openThemeEditor(input);
  (field.element() as HTMLElement).focus();
  useThemeEditorStore.getState().closeThemeEditor();

  await expect.element(field).toHaveFocus();
});
