const CHIP_PICKERS = ":has([data-chat-provider-model-picker-label], [data-composer-control-label])";

// A control column of fixed width: a select, a text input or a chip picker.
const FIXED_WIDTH = `:is(
  :has(> [data-slot="select-trigger"]),
  :has(> :is(div, span) > [data-slot="select-trigger"]):not(
    :has(> :is(div, span) > :not([data-slot="select-trigger"], input))
  ),
  :has([data-slot="input-control"]):not(:has([type="number"], [data-slot="number-field-input"])),
  ${CHIP_PICKERS}
)`;

/**
 * Keeps `data-fixed` and `data-chips` on a settings control cell. Stylesheets read them; the same
 * checks as `:has()` selectors in front of descendant selectors restyled the whole page.
 */
export function trackSettingsControlKind(cell: HTMLElement | null): (() => void) | undefined {
  if (cell === null) return undefined;
  const update = () => {
    cell.toggleAttribute("data-fixed", cell.matches(FIXED_WIDTH));
    cell.toggleAttribute("data-chips", cell.matches(CHIP_PICKERS));
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(cell, { childList: true, subtree: true });
  return () => observer.disconnect();
}
