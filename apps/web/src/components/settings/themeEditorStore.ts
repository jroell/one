import { create } from "zustand";

import {
  getThemeDefinition,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreference,
} from "../../themePalette";

export type ThemeEditorSessionInput = {
  editingThemeId: string | null;
  seedThemeId: string | null;
  seedName: string | null;
  initialAppearance: ThemeAppearance;
};

export type ThemeEditorSession = ThemeEditorSessionInput & {
  id: number;
};

type ThemeEditorStore = {
  session: ThemeEditorSession | null;
  openThemeEditor: (session: ThemeEditorSessionInput) => void;
  closeThemeEditor: () => void;
};

let nextSessionId = 0;
// The control that was focused when the editor opened, so closing it hands focus back there.
let opener: HTMLElement | null = null;

function rememberOpener(): void {
  const active = document.activeElement;
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
}

function returnFocusToOpener(): void {
  const target = opener;
  opener = null;
  if (!target) return;
  // The panel unmounts on the next render; focus is on the page again only after that.
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (target.isConnected && (active === null || active === document.body)) target.focus();
  });
}

export const useThemeEditorStore = create<ThemeEditorStore>((set, get) => ({
  session: null,
  openThemeEditor: (session) => {
    // A second open, from inside the open editor, keeps the first opener.
    if (get().session === null) rememberOpener();
    set({ session: { ...session, id: ++nextSessionId } });
  },
  closeThemeEditor: () => {
    set({ session: null });
    returnFocusToOpener();
  },
}));

export function toggleThemeEditorForTheme(input: {
  theme: ThemePreference;
  themeHalves: ThemeHalves | null;
  initialAppearance: ThemeAppearance;
}): void {
  const store = useThemeEditorStore.getState();
  if (store.session) {
    store.closeThemeEditor();
    return;
  }

  const baseThemeId = getThemeDefinition(input.theme)?.id ?? null;
  const activeThemeId = input.themeHalves?.[input.initialAppearance] ?? baseThemeId;
  const seedThemeId = activeThemeId ? (getThemeDefinition(activeThemeId)?.id ?? null) : null;
  store.openThemeEditor({
    editingThemeId: null,
    seedThemeId,
    seedName: null,
    initialAppearance: input.initialAppearance,
  });
}
