"use client";

import type { JARVISState } from "@/types/jarvis";

/**
 * Batch 26: one tiny store the chat publishes the eye's state to (thinking
 * while an answer is worked out; listening and speaking with voice), so every
 * eye on the page (ChatEye) follows it without the page re-rendering. Nothing
 * waits for it: the eye's animation is CSS, eased by StayfulEye.
 */
export type ChatEyeState = JARVISState;

let current: ChatEyeState = "idle";
const listeners = new Set<() => void>();

export function setChatEye(next: ChatEyeState): void {
  if (current === next) return;
  current = next;
  for (const l of listeners) l();
}

export function readChatEye(): ChatEyeState {
  return current;
}

export function subscribeChatEye(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
