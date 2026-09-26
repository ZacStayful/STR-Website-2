/**
 * The Keep / Pass state machine, with no imports, so the card's client
 * component can use it without pulling the picks engine into the browser.
 * reactions.ts re-exports it; server code should import from there.
 */

export type DealReaction = 'keep' | 'pass';

export function isDealReaction(v: unknown): v is DealReaction {
  return v === 'keep' || v === 'pass';
}

/**
 * What a tap asks for. Tapping the button that is already on clears it;
 * tapping the other one switches. The server is sent this target state,
 * never "toggle", so a replayed request lands in the same place.
 */
export function nextReaction(current: DealReaction | null, tapped: DealReaction): DealReaction | null {
  return current === tapped ? null : tapped;
}
