"use client";

import type { ChatReply, FullEvent } from "@/lib/chat/reply";

/** A new id for a new question (a retry of the same question reuses its id: never asked or charged twice). */
export function newTurnId(): string {
  return crypto.randomUUID();
}

/** A quick answer. Throws on a network failure (the caller can retry with the same id). */
export async function sendQuick(clientTurnId: string, question: string, signal?: AbortSignal): Promise<ChatReply> {
  const res = await fetch("/api/chat/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientTurnId, question }), signal });
  if (res.status === 401) throw new Error("signed_out");
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as ChatReply;
}

/**
 * A full-view question. A decision made before the model runs comes back as
 * JSON; otherwise the events stream in and `onEvent` sees each. Resolves with
 * the final reply; throws if the stream drops before it ends.
 */
export async function sendFull(input: { clientTurnId: string; question: string; conversationId: string | null }, onEvent: (e: FullEvent) => void, signal?: AbortSignal): Promise<ChatReply> {
  const res = await fetch("/api/chat/full", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal });
  if (res.status === 401) throw new Error("signed_out");
  if (!res.ok) throw new Error(`http_${res.status}`);
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) return (await res.json()) as ChatReply;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no_stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let final: ChatReply | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let e: FullEvent;
      try {
        e = JSON.parse(line.slice(6)) as FullEvent;
      } catch {
        continue;
      }
      onEvent(e);
      if (e.type === "done") final = e.reply;
    }
  }
  if (!final) throw new Error("dropped");
  return final;
}
