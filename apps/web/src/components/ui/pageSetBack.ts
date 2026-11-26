const active = new Set<HTMLElement>();

function apply() {
  document.documentElement.toggleAttribute("data-page-set-back", active.size > 0);
}

/**
 * Ref for a dialog backdrop: while it is mounted and not leaving, `<html data-page-set-back>` is
 * set and the page behind scales back. A script sets the flag because a `:has()` rule on `html`
 * would make the browser re-check every ancestor after each node any React commit inserts or
 * removes, and re-style thousands of elements on a thread switch.
 */
export function pageSetBackRef(node: HTMLElement | null) {
  if (node === null) return;
  const update = () => {
    if (node.hasAttribute("data-ending-style")) active.delete(node);
    else active.add(node);
    apply();
  };
  const observer = new MutationObserver(update);
  update();
  observer.observe(node, { attributes: true, attributeFilter: ["data-ending-style"] });
  return () => {
    observer.disconnect();
    active.delete(node);
    apply();
  };
}
