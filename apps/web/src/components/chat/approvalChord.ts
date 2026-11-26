/**
 * The request the Approve and Decline chords answer: the oldest one that is not skipped. The chat
 * view skips requests the typing guard holds hidden, and a card skips requests already leaving, so
 * the chord targets the request whose card shows the chord hint. Whether the person can see that
 * card is a separate check (`approvalCardSight`).
 */
export function chordApprovalRequestId<Id extends string>(
  requestIds: Iterable<Id>,
  skipped: { readonly has: (id: Id) => boolean } | undefined,
): Id | null {
  for (const id of requestIds) {
    if (!skipped?.has(id)) return id;
  }
  return null;
}

/** What the person can see of the card a chord would answer, read from the page at the keypress. */
export type ApprovalCardSight =
  | { readonly kind: "seen" }
  /** The card is not in front of the person: scroll it (or the end of the thread) into view. */
  | { readonly kind: "off-screen"; readonly card: HTMLElement | null }
  /** The whole app or this thread is out of sight, so there is nothing to reveal or answer. */
  | { readonly kind: "hidden" };

/**
 * Whether the person can see the card of `requestId`. The boot handoff holds the app at zero
 * opacity, which hit testing does not see, so it is read from the page. A card in an inert column
 * (the right panel maximized) is hidden. Otherwise the card's buttons must be on the screen and
 * the topmost thing at their centre, so a scrolled-out or covered card is not seen.
 */
export function approvalCardSight(requestId: string): ApprovalCardSight {
  const handoff = document.documentElement.dataset.oneHandoff;
  if (handoff === "wait" || handoff === "hold") return { kind: "hidden" };
  const card = document.querySelector<HTMLElement>(
    `[data-approval-card][data-approval-request-id="${CSS.escape(requestId)}"]`,
  );
  if (card === null) return { kind: "off-screen", card: null };
  if (card.closest("[inert]") !== null) return { kind: "hidden" };
  const buttons = card.querySelector<HTMLElement>("[data-approval-actions]") ?? card;
  const rect = buttons.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const onScreen =
    rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
  const top = onScreen ? document.elementFromPoint(x, y) : null;
  return top !== null && buttons.contains(top) ? { kind: "seen" } : { kind: "off-screen", card };
}
