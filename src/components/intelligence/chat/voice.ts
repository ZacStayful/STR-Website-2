"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notifyCreditChanged } from "@/lib/credit/client";
import { VOICE_MAX_SECONDS } from "@/lib/chat/config";
import { setChatEye } from "./chat-state";

/**
 * Batch 26b: talking to Stayful Intelligence. Tap the microphone and speak;
 * recording stops by itself after a short silence (or at VOICE_MAX_SECONDS, or
 * on a second tap). The recording becomes text (/api/chat/listen) and is sent
 * as an ordinary question; when the question was spoken, the answer is spoken
 * back in the Stayful Intelligence voice (/api/speak). The eye listens,
 * thinks and speaks along.
 *
 * It never hears itself (Zac, 9 Oct): the microphone is closed for as long
 * as an answer is playing, listening can't start while it speaks, and it
 * won't start speaking over a question the member has begun. After a spoken
 * answer it listens again on its own (a conversation), AFTER_SPEAKING_MS
 * after its voice has stopped; silence there ends the conversation quietly,
 * with nothing sent or charged. Typing, or tapping to stop it speaking, ends
 * the conversation too.
 *
 *   idle       nothing happening
 *   listening  the microphone is on
 *   hearing    the recording is being turned into text
 *   speaking   an answer is playing
 */
export type VoicePhase = "idle" | "listening" | "hearing" | "speaking";

/** How loud counts as speech (RMS of the time-domain signal, 0–1). */
const SPEECH_LEVEL = 0.025;
/** Quiet after speech for this long ends the recording. */
const SILENCE_MS = 1300;
/** No speech at all for this long: give up. */
const NO_SPEECH_MS = 8000;
/** A gap long enough to tell apart a real recording from a tap. */
const MIN_RECORDING_MS = 400;
/** The gap between its voice stopping and the microphone opening again, so the end of its own words is never heard. */
const AFTER_SPEAKING_MS = 500;
/** A silent clip, played on the tap that starts listening, so a phone lets the answer play later. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  context: AudioContext | null;
  chunks: Blob[];
  started: number;
  voiced: boolean;
  timers: number[];
  frame: number;
  discard: boolean;
  /** Opened by itself after a spoken answer (not by a tap): silence ends it without a word. */
  auto: boolean;
}

function closeRecording(r: Recording): void {
  for (const t of r.timers) window.clearTimeout(t);
  cancelAnimationFrame(r.frame);
  for (const track of r.stream.getTracks()) track.stop();
  r.context?.close().catch(() => {});
}

export function useVoice(opts: { enabled: boolean; onHeard: (text: string) => void; onMessage: (message: string) => void }) {
  const [phase, setPhaseState] = useState<VoicePhase>("idle");
  const [supported, setSupported] = useState(false);
  const phaseRef = useRef<VoicePhase>("idle");
  const rec = useRef<Recording | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  // A spoken conversation is going on: after a spoken answer, listen again.
  const conversation = useRef(false);
  const followOn = useRef<number | null>(null);
  const handlers = useRef(opts);
  useEffect(() => {
    handlers.current = opts;
  });

  useEffect(() => setSupported(opts.enabled && voiceSupported()), [opts.enabled]);

  const setPhase = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
    setChatEye(p === "listening" ? "listening" : p === "hearing" ? "thinking" : p === "speaking" ? "speaking" : "idle");
  }, []);

  const audio = useCallback((): HTMLAudioElement => {
    if (!player.current) player.current = new Audio();
    return player.current;
  }, []);

  const releaseUrl = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  const clearFollowOn = useCallback(() => {
    if (followOn.current !== null) window.clearTimeout(followOn.current);
    followOn.current = null;
  }, []);

  // Stops the voice (and any answer still on its way) without ending the conversation.
  const haltAudio = useCallback(() => {
    const a = player.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    releaseUrl();
    pending.current?.abort();
    if (phaseRef.current === "speaking") setPhase("idle");
  }, [releaseUrl, setPhase]);

  /** The member stops it speaking: the voice stops and it doesn't listen again by itself. */
  const stopSpeaking = useCallback(() => {
    conversation.current = false;
    clearFollowOn();
    haltAudio();
  }, [clearFollowOn, haltAudio]);

  /** The member typed: no more listening by itself. */
  const endConversation = useCallback(() => {
    conversation.current = false;
    clearFollowOn();
  }, [clearFollowOn]);

  const transcribe = useCallback(
    async (blob: Blob, seconds: number) => {
      setPhase("hearing");
      const ctrl = new AbortController();
      pending.current = ctrl;
      try {
        const form = new FormData();
        form.append("audio", blob, "question");
        form.append("seconds", String(Math.round(seconds * 10) / 10));
        const res = await fetch("/api/chat/listen", { method: "POST", body: form, signal: ctrl.signal });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (res.status === 402) {
          handlers.current.onMessage("You’re out of credit for voice. Top up, or type your question.");
        } else if (!res.ok) {
          handlers.current.onMessage(body.error ?? "I couldn’t hear that. Try again, or type it.");
        } else if (!body.text) {
          handlers.current.onMessage("I didn’t catch that. Try again, or type it.");
        } else {
          notifyCreditChanged();
          setPhase("idle");
          conversation.current = true;
          handlers.current.onHeard(body.text);
          return;
        }
      } catch {
        if (!ctrl.signal.aborted) handlers.current.onMessage("I couldn’t hear that. Try again, or type it.");
      } finally {
        if (pending.current === ctrl) pending.current = null;
      }
      if (phaseRef.current === "hearing") setPhase("idle");
    },
    [setPhase],
  );

  const stopListening = useCallback(() => {
    const r = rec.current;
    if (!r || r.recorder.state === "inactive") return;
    r.recorder.stop();
  }, []);

  const cancelListening = useCallback(() => {
    conversation.current = false;
    const r = rec.current;
    if (!r) return;
    r.discard = true;
    if (r.recorder.state !== "inactive") r.recorder.stop();
    else closeRecording(r);
  }, []);

  const startListening = useCallback(async (auto = false) => {
    // Never while it is speaking (or fetching what to say): it must not hear itself.
    if (phaseRef.current !== "idle") return;
    clearFollowOn();
    if (!auto) {
      // On the tap itself: lets a phone play the spoken answer later without another tap.
      try {
        const a = audio();
        a.src = SILENT_WAV;
        await a.play().catch(() => {});
        a.pause();
      } catch {
        /* not needed on a desktop */
      }
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      conversation.current = false;
      if (!auto) handlers.current.onMessage("I can’t use your microphone. Allow it in your browser’s settings, or type your question.");
      return;
    }
    // It may have started speaking while the browser asked for the microphone: then don't listen.
    if (phaseRef.current !== "idle") {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      handlers.current.onMessage("Voice doesn’t work in this browser. Type your question instead.");
      return;
    }
    let context: AudioContext | null = null;
    const r: Recording = { recorder, stream, context: null, chunks: [], started: Date.now(), voiced: false, timers: [], frame: 0, discard: false, auto };
    rec.current = r;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) r.chunks.push(e.data);
    };
    recorder.onstop = () => {
      closeRecording(r);
      if (rec.current === r) rec.current = null;
      const ms = Date.now() - r.started;
      if (r.discard) {
        if (phaseRef.current === "listening") setPhase("idle");
        return;
      }
      if (!r.voiced || ms < MIN_RECORDING_MS || r.chunks.length === 0) {
        setPhase("idle");
        // Listening by itself and nobody spoke: the conversation is over, quietly.
        if (r.auto) conversation.current = false;
        else handlers.current.onMessage("I didn’t catch that. Tap the microphone and speak, or type it.");
        return;
      }
      void transcribe(new Blob(r.chunks, { type: recorder.mimeType || mime || "audio/webm" }), ms / 1000);
    };

    // Silence detection: stop a short while after the member stops talking.
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        context = new Ctx();
        r.context = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        let quietSince = 0;
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          const level = Math.sqrt(sum / data.length);
          const now = Date.now();
          if (level > SPEECH_LEVEL) {
            r.voiced = true;
            quietSince = 0;
          } else if (r.voiced) {
            if (!quietSince) quietSince = now;
            else if (now - quietSince > SILENCE_MS) {
              stopListening();
              return;
            }
          }
          r.frame = requestAnimationFrame(tick);
        };
        r.frame = requestAnimationFrame(tick);
        r.timers.push(
          window.setTimeout(() => {
            if (!r.voiced) stopListening();
          }, NO_SPEECH_MS),
        );
      } else {
        // No level meter: rely on the tap to stop, and assume speech.
        r.voiced = true;
      }
    } catch {
      r.voiced = true;
    }
    r.timers.push(window.setTimeout(() => stopListening(), VOICE_MAX_SECONDS * 1000));
    recorder.start(250);
    setPhase("listening");
  }, [audio, clearFollowOn, setPhase, stopListening, transcribe]);

  /** Speaks an answer in the Stayful Intelligence voice (charged as AI voice). */
  const speak = useCallback(
    async (text: string) => {
      const words = text.trim();
      if (!words) return;
      // The member has started another question: don't talk over them.
      if (phaseRef.current === "listening" || phaseRef.current === "hearing") return;
      clearFollowOn();
      haltAudio();
      const ctrl = new AbortController();
      pending.current = ctrl;
      setPhase("speaking");
      try {
        const res = await fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: words }), signal: ctrl.signal });
        if (!res.ok) throw new Error(`speak ${res.status}`);
        const blob = await res.blob();
        if (ctrl.signal.aborted) return;
        releaseUrl();
        objectUrl.current = URL.createObjectURL(blob);
        const a = audio();
        a.src = objectUrl.current;
        const done = (finished: boolean) => {
          releaseUrl();
          if (phaseRef.current !== "speaking") return;
          setPhase("idle");
          // A conversation: listen again once its voice has stopped (never while it plays).
          if (finished && conversation.current) {
            followOn.current = window.setTimeout(() => {
              followOn.current = null;
              if (conversation.current && phaseRef.current === "idle") void startListening(true);
            }, AFTER_SPEAKING_MS);
          }
        };
        a.onended = () => done(true);
        a.onerror = () => done(false);
        notifyCreditChanged();
        await a.play();
      } catch {
        if (!ctrl.signal.aborted) {
          conversation.current = false;
          if (phaseRef.current === "speaking") setPhase("idle");
          handlers.current.onMessage("I couldn’t say that out loud just now. The answer is above.");
        }
      } finally {
        if (pending.current === ctrl) pending.current = null;
      }
    },
    [audio, clearFollowOn, haltAudio, releaseUrl, setPhase, startListening],
  );

  // Leaving the page: microphone off, nothing playing, nothing pending.
  useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        r.discard = true;
        try {
          if (r.recorder.state !== "inactive") r.recorder.stop();
        } catch {
          /* already stopped */
        }
        closeRecording(r);
      }
      pending.current?.abort();
      if (followOn.current !== null) window.clearTimeout(followOn.current);
      player.current?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      setChatEye("idle");
    },
    [],
  );

  return { supported, phase, startListening, stopListening, cancelListening, speak, stopSpeaking, endConversation };
}

export type Voice = ReturnType<typeof useVoice>;
