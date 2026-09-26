"use client";

import { createContext, useContext } from "react";
import type { DealReaction } from "@/lib/marketplace/reaction-state";

/**
 * An optional ear on the deal cards' Keep and Pass. A page that needs to know
 * when its cards have been answered (the Today screen's "done for today")
 * wraps them in a provider; everywhere else there is none and the cards
 * behave exactly as before. Called only after the server has saved the
 * answer, never optimistically.
 */
export interface DealReactionListener {
  /** A Keep, a Pass or an undo has saved. Null is an undo. */
  reacted(dealId: string, reaction: DealReaction | null): void;
  /** After a Pass: the "why?" picker has closed (reasons saved, skipped or dismissed). */
  settled(dealId: string): void;
}

export const DealReactionListenerContext = createContext<DealReactionListener | null>(null);

export function useDealReactionListener(): DealReactionListener | null {
  return useContext(DealReactionListenerContext);
}
