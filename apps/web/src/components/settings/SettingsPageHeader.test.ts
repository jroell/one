import { decodeMsg } from "gt-react";
import { describe, expect, it } from "vite-plus/test";

import { SETTINGS_PAGE_INTROS } from "./SettingsPageHeader";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

describe("settings page intros", () => {
  it("gives every settings page a title and one short line of purpose", () => {
    const missing = Object.keys(SETTINGS_SECTION_LABELS).filter(
      (path) => SETTINGS_PAGE_INTROS[path] === undefined,
    );
    expect(missing).toEqual([]);

    const unclear = Object.entries(SETTINGS_PAGE_INTROS).flatMap(([path, intro]) => {
      const title = decodeMsg(intro.title);
      const purpose = decodeMsg(intro.purpose);
      const ok =
        title.length > 0 && purpose.length > 0 && purpose.length <= 80 && !/[—–]/.test(purpose);
      return ok ? [] : [`${path}: ${title} / ${purpose}`];
    });
    expect(unclear).toEqual([]);
  });
});
