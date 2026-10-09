"use client";

/**
 * Batch 26: one tiny store the chat publishes to while an answer is being
 * worked out, so the eye (ChatEye) can show "thinking" without the page
 * re-rendering. Nothing waits for it: the eye's animation is CSS.
 */
let thinking = false;
const listeners = new Set<() => void>();

export function setChatThinking(next: boolean): void {
  if (thinking === next) return;
  thinking = next;
  for (const l of listeners) l();
}

export function readChatThinking(): boolean {
  return thinking;
}

export function subscribeChatThinking(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
