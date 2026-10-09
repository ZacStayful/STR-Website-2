"use client";

import { useSyncExternalStore } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import { readChatEye, subscribeChatEye } from "./chat-state";

/** Batch 26: an eye that follows the chat: thinking while an answer is worked out, listening and speaking with voice, idle otherwise. */
export function ChatEye({ size, level, label, className }: { size: number; level: EyeLevel; label?: string; className?: string }) {
  const state = useSyncExternalStore(subscribeChatEye, readChatEye, () => "idle" as const);
  return <StayfulEye size={size} level={level} label={label} state={state} className={className} />;
}
