/**
 * The request the Approve and Decline chords answer: the oldest one that is not skipped. The chat
 * view skips requests the typing guard holds hidden, and a card skips requests already leaving, so
 * the chord only ever answers the request whose card shows the chord hint at that moment.
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
