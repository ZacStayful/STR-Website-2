"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Play, Pause, RotateCcw, Volume2, Loader2 } from "lucide-react";
import { JarvisEye } from "@/components/JarvisEye";
import type { JARVISState } from "@/types/jarvis";
import type { AnalysisResult } from "@/lib/types";

interface AnalyserNarratorProps {
  result: AnalysisResult;
}

// A stable identity for "which analysis is this" so the narrator resets its
// cached summary when the user runs a new report.
function resultKey(r: AnalysisResult): string {
  return `${r.property.address}|${r.property.postcode}|${r.createdAt}`;
}

export function AnalyserNarrator({ result }: AnalyserNarratorProps) {
  const [open, setOpen] = useState(false);
  const [eyeState, setEyeState] = useState<JARVISState>("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // a network request is in flight

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const key = resultKey(result);
  const keyRef = useRef(key);

  // Reset everything when a new analysis loads.
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setSummary(null);
      setError(null);
      setVoiceNote(null);
      setEyeState("idle");
      setOpen(false);
      stopAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function revokeUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
  }, []);

  // Clean up audio + object URLs on unmount.
  useEffect(() => {
    return () => {
      stopAudio();
      revokeUrl();
    };
  }, [stopAudio]);

  // Speak the given text via ElevenLabs. Degrades gracefully to text-only.
  const speak = useCallback(async (text: string) => {
    setVoiceNote(null);
    setBusy(true);
    setEyeState("thinking");
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        // 503 = not configured; anything else = transient failure. Either way
        // the written summary is still on screen, so don't treat it as fatal.
        setVoiceNote(
          res.status === 503
            ? "Voice playback isn't set up yet — here's the written summary."
            : "Couldn't play the voice summary just now — the text is below.",
        );
        setEyeState("idle");
        return;
      }

      const blob = await res.blob();
      revokeUrl();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;

      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audioRef.current = audio;
      }
      audio.src = url;
      audio.onplay = () => setEyeState("speaking");
      audio.onended = () => setEyeState("idle");
      audio.onpause = () => {
        // Treat a pause that isn't the natural end as returning to idle.
        if (!audio!.ended) setEyeState("idle");
      };
      audio.onerror = () => {
        setVoiceNote("Couldn't play the audio on this device — the text is below.");
        setEyeState("idle");
      };

      try {
        await audio.play();
      } catch {
        // Autoplay blocked (no direct user gesture) — leave the Play button for
        // the user to start it manually.
        setEyeState("idle");
        setVoiceNote("Tap play to hear the summary.");
      }
    } catch (err) {
      console.error("[narrator] speak failed:", err);
      setVoiceNote("Couldn't play the voice summary — the text is below.");
      setEyeState("idle");
    } finally {
      setBusy(false);
    }
  }, []);

  // Generate the summary, then speak it.
  const generate = useCallback(async () => {
    setError(null);
    setVoiceNote(null);
    setBusy(true);
    setEyeState("thinking");
    try {
      const res = await fetch("/api/summarise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
      };
      if (!res.ok || !data.summary) {
        setError(data.error || "Couldn't generate a summary right now.");
        setEyeState("idle");
        setBusy(false);
        return;
      }
      setSummary(data.summary);
      setBusy(false);
      await speak(data.summary);
    } catch (err) {
      console.error("[narrator] summarise failed:", err);
      setError("Couldn't reach the narrator. Please try again.");
      setEyeState("idle");
      setBusy(false);
    }
  }, [result, speak]);

  const handleTrigger = useCallback(() => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !summary && !busy) {
      void generate();
    }
  }, [open, summary, busy, generate]);

  const handleClose = useCallback(() => {
    setOpen(false);
    stopAudio();
    setEyeState("idle");
  }, [stopAudio]);

  // Primary control: play / pause / replay depending on state.
  const isSpeaking = eyeState === "speaking";
  const handlePlayPause = useCallback(() => {
    const a = audioRef.current;
    if (isSpeaking && a) {
      a.pause();
      return;
    }
    if (a && a.src) {
      // Replay the audio we already have — no need to hit ElevenLabs again.
      a.currentTime = 0;
      void a.play().catch(() => {
        if (summary) void speak(summary);
      });
      return;
    }
    // Nothing buffered yet — synthesise from the summary.
    if (summary) void speak(summary);
  }, [isSpeaking, summary, speak]);

  return (
    <>
      {/* ── Panel ─────────────────────────────────────────── */}
      {open && (
        <div
          role="dialog"
          aria-label="Stayful AI analyst"
          className="fixed bottom-[104px] right-4 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:right-6"
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-4 py-3">
            <div className="grid h-9 w-9 place-items-center overflow-visible">
              <div style={{ transform: "scale(0.36)", transformOrigin: "center" }}>
                <JarvisEye state={eyeState} size={90} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Stayful AI analyst</p>
              <p className="truncate text-xs text-muted-foreground">
                {eyeState === "thinking"
                  ? "Reading your analysis…"
                  : eyeState === "speaking"
                    ? "Speaking…"
                    : "Voice summary of your report"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close narrator"
              className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="max-h-[40vh] overflow-y-auto px-4 py-4">
            {error ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            ) : summary ? (
              <>
                <p className="text-sm leading-relaxed text-foreground">{summary}</p>
                {voiceNote && (
                  <p className="mt-3 text-xs text-muted-foreground">{voiceNote}</p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Summarising your report…
              </div>
            )}
          </div>

          {/* Footer controls */}
          {summary && !error && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={handlePlayPause}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isSpeaking ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {busy ? "Preparing…" : isSpeaking ? "Stop" : "Replay"}
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Volume2 className="h-3.5 w-3.5" /> AI-generated
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Floating eye trigger ──────────────────────────── */}
      <button
        type="button"
        onClick={handleTrigger}
        aria-label={open ? "Hide AI analyst" : "Ask the AI analyst to summarise this report"}
        aria-expanded={open}
        title="AI analyst — summarise & help me decide"
        className="fixed bottom-6 right-4 z-50 grid h-[60px] w-[60px] place-items-center rounded-full transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:right-6"
        style={{ background: "transparent", border: "none", cursor: "pointer" }}
      >
        <div style={{ transform: "scale(0.43)", transformOrigin: "center" }}>
          <JarvisEye state={eyeState} size={140} />
        </div>
      </button>
    </>
  );
}
