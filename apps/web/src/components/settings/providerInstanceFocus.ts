/** The provider the user last opened from the list, so going back can land on its row. */
let lastOpened: string | null = null;

export function rememberOpenedProvider(instanceId: string | null) {
  lastOpened = instanceId;
}

/** The row to focus when the list comes back, once; null on a first visit or a deep link. */
export function takeOpenedProvider(): string | null {
  const instanceId = lastOpened;
  lastOpened = null;
  return instanceId;
}

/**
 * Commits a field the user is still typing in. A field commits on blur, and leaving a provider
 * (the breadcrumb, a row, or browser Back) removes the field without a blur, so the edit would be
 * lost: blur it first.
 */
export function commitFocusedField() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
}

/** Focuses the provider page's title (its name), or the list row a provider was opened from. */
export function focusProviderTarget(instanceId: string | null, returnTo: string | null) {
  if (instanceId !== null) {
    document
      .querySelector<HTMLElement>("[data-settings-page-title]")
      ?.focus({ preventScroll: true });
    return;
  }
  if (returnTo === null) return;
  document
    .querySelector<HTMLElement>(`[data-provider-row="${CSS.escape(returnTo)}"]`)
    ?.focus({ preventScroll: true });
}
