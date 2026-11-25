import { useAtomValue } from "@effect/atom-react";
import { T, useGT, useMessages } from "gt-react";
import { SearchIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd, KbdGroup } from "../ui/kbd";
import { buildShortcutSections } from "./ShortcutsDialog.logic";
import { SHORTCUTS_SHEET_ATTRIBUTE } from "../../shortcuts/shortcutsSheet";
import { setShortcutsDialogOpen, useShortcutsDialogStore } from "./shortcutsDialogStore";

/** Mounted once by the command palette; `shortcuts.show` and the palette row open it. */
export function ShortcutsDialogHost() {
  const open = useShortcutsDialogStore((state) => state.open);
  return open ? (
    <Dialog open onOpenChange={setShortcutsDialogOpen}>
      <ShortcutsDialogPopup />
    </Dialog>
  ) : null;
}

function ShortcutsDialogPopup() {
  const gt = useGT();
  const m = useMessages();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sendShortcut = useClientSettings((settings) => settings.sendShortcut);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const sections = buildShortcutSections(keybindings, { query, resolve: m, sendShortcut });

  return (
    <DialogPopup
      className="sm:max-w-xl"
      initialFocus={searchRef}
      {...{ [SHORTCUTS_SHEET_ATTRIBUTE]: "" }}
    >
      <DialogHeader>
        <DialogTitle>
          <T>Keyboard shortcuts</T>
        </DialogTitle>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={gt("Filter shortcuts")}
            aria-label={gt("Filter shortcuts")}
            size="sm"
          />
        </InputGroup>
      </DialogHeader>
      <DialogPanel>
        {sections.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <T>No shortcuts match.</T>
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <section key={section.id} aria-label={section.title}>
                <h3 className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                  {section.title}
                </h3>
                <ul>
                  {section.rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-4 px-2 py-1.5"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{row.label}</span>
                        {row.qualifier ? (
                          <span className="truncate text-muted-foreground/70 text-xs">
                            {row.qualifier}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {row.keys.map((caps, index) => (
                          <Fragment key={caps.join("+")}>
                            {index > 0 ? (
                              <span className="text-muted-foreground/70 text-xs">
                                {row.keysJoiner === "to" ? (
                                  <T context="between the first and last key of a numbered shortcut family">
                                    to
                                  </T>
                                ) : (
                                  <T context="between two keys that run the same command">or</T>
                                )}
                              </span>
                            ) : null}
                            <KbdGroup>
                              {caps.map((cap) => (
                                <Kbd key={cap}>{cap}</Kbd>
                              ))}
                            </KbdGroup>
                          </Fragment>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </DialogPanel>
    </DialogPopup>
  );
}
