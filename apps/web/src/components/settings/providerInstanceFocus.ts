/**
 * Commits a field the user is still typing in inside the open provider's page. A field commits on
 * blur, and leaving the provider (the breadcrumb, a row, or browser Back) removes the field without
 * one, so the edit would be lost: blur it first. Fields outside the provider page are left alone.
 */
export function commitFocusedField() {
  const active = document.activeElement;
  if (
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
    active.closest("[data-provider-editor]") !== null
  ) {
    active.blur();
  }
}

/**
 * Focuses the provider page's title when one opens. When the list comes back it focuses the row the
 * provider was opened from, or the page title when that row is not known or no longer there.
 */
export function focusProviderTarget(instanceId: string | null, returnTo: string | null) {
  const title = () =>
    document
      .querySelector<HTMLElement>("[data-settings-page-title]")
      ?.focus({ preventScroll: true });
  if (instanceId !== null) return title();
  // A list nobody came back to (a first visit) keeps the focus it was given.
  if (returnTo === null) return;
  const row = document.querySelector<HTMLElement>(`[data-provider-row="${CSS.escape(returnTo)}"]`);
  if (row === null) return title();
  row.focus({ preventScroll: true });
}
