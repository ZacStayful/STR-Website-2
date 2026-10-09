"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, LoaderCircle, Mic, Square, Volume2 } from "lucide-react";
import { MAX_QUESTION_CHARS } from "@/lib/chat/config";
import type { Voice } from "./voice";

/**
 * Batch 26: the box at the bottom of every chat surface: a growing text box,
 * the microphone (when voice is on) and send. It never moves: the answers
 * scroll above it, so the member can always type or talk.
 */
export function ChatComposer(p: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  voice: Voice | null;
  autoFocus?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const listening = p.voice?.phase === "listening";
  const hearing = p.voice?.phase === "hearing";
  const speaking = p.voice?.phase === "speaking";

  // Grow with the text, up to four lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [p.value]);

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      <label htmlFor={p.id} className="sr-only">
        Ask Stayful Intelligence
      </label>
      <textarea
        ref={box}
        id={p.id}
        rows={1}
        autoFocus={p.autoFocus}
        maxLength={MAX_QUESTION_CHARS}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            p.onSubmit();
          }
        }}
        placeholder={listening ? "Listening…" : hearing ? "Hearing you…" : p.placeholder}
        disabled={p.busy || listening || hearing}
        className="max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-white/25 bg-white/10 px-4 py-2.5 text-[16px] leading-6 text-white placeholder:text-white/50 focus:border-[#B9D5C6] focus:outline-none disabled:opacity-70 sm:text-sm"
      />
      {p.voice?.supported && (
        <button
          type="button"
          onClick={() => (listening ? p.voice?.stopListening() : speaking ? p.voice?.stopSpeaking() : p.voice?.startListening())}
          disabled={p.busy || hearing}
          aria-label={listening ? "Stop listening" : speaking ? "Stop speaking" : "Ask by voice"}
          aria-pressed={listening}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
            listening ? "border-[#f4a435] bg-[#f4a435] text-[#1a2118]" : speaking ? "border-[#B9D5C6] bg-[#B9D5C6]/20 text-white" : "border-white/30 text-white hover:bg-white/10"
          }`}
        >
          {hearing ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : listening ? <Square className="size-4 fill-current" aria-hidden /> : speaking ? <Volume2 className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
        </button>
      )}
      <button
        type="submit"
        disabled={p.busy || listening || hearing || !p.value.trim()}
        aria-label="Send"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#B9D5C6] text-[#1a2118] transition-opacity disabled:opacity-40"
      >
        {p.busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <ArrowUp className="size-5" aria-hidden />}
      </button>
    </form>
  );
}
