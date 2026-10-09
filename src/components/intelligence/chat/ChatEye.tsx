"use client";

import { useSyncExternalStore } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import { readChatThinking, subscribeChatThinking } from "./chat-state";

/** Batch 26: the view's eye, which "thinks" while a typed answer streams (and is idle otherwise, exactly as before). */
export function ChatEye({ size, level, label }: { size: number; level: EyeLevel; label?: string }) {
  const thinking = useSyncExternalStore(subscribeChatThinking, readChatThinking, () => false);
  return <StayfulEye size={size} level={level} label={label} state={thinking ? "thinking" : "idle"} />;
}
