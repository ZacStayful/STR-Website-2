"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import { creditFetch, notifyCreditChanged } from "@/lib/credit/client";
import { briefingFeedbackAction, briefingPlayedAction, briefingShownAction, dismissBriefingAction } from "../briefing-actions";

/** Point the player at the clip and start it (outside the component: it sets the element's own handlers). */
async function playFrom(audio: HTMLAudioElement, url: string, onEnd: () => void, onError: () => void): Promise<void> {
  audio.src = url;
  audio.onended = onEnd;
  audio.onerror = onError;
  await audio.play();
}

/**
 * Batch 23b: today's briefing at the top of Today, for a member who did not
 * come in from the email. One card, dismissible; "Today's briefing" reopens
 * it. Play reads it aloud through /api/speak at the price on the button.
 */
export function BriefingCard({
  id,
  greeting,
  opener,
  spoken,
  nudges,
  open: initiallyOpen,
  firstShow,
  playLabel,
  feedback: initialFeedback,
  eyeLevel,
}: {
  id: string;
  greeting: string;
  opener: string;
  spoken: string;
  nudges: { text: string; nextStep: string; href: string }[];
  open: boolean;
  firstShow: boolean;
  playLabel: string | null;
  feedback: "useful" | "not_for_me" | null;
  eyeLevel: EyeLevel;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (firstShow) start(() => briefingShownAction(id));
  }, [firstShow, id]);
  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
  }, []);
  const revokeUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);
  // Clean up the audio and its object URL on unmount.
  useEffect(
    () => () => {
      stopAudio();
      revokeUrl();
    },
    [stopAudio, revokeUrl],
  );

  const dismiss = () => {
    setOpen(false);
    stopAudio();
    start(() => dismissBriefingAction(id));
  };

  const play = useCallback(async () => {
    if (playing) {
      stopAudio();
      setPlaying(false);
      return;
    }
    setNote(null);
    setPlaying(true);
    try {
      const res = await creditFetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: spoken }) });
      if (!res.ok) {
        setNote(res.status === 503 ? "Voice playback isn't set up yet." : "Couldn't play it just now.");
        setPlaying(false);
        return;
      }
      const blob = await res.blob();
      notifyCreditChanged();
      revokeUrl();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      await playFrom(audio, url, () => setPlaying(false), () => {
        setNote("Couldn't play the audio on this device.");
        setPlaying(false);
      });
      start(() => briefingPlayedAction(id));
    } catch {
      setNote("Couldn't play it just now.");
      setPlaying(false);
    }
  }, [playing, spoken, id, stopAudio, revokeUrl]);

  const answer = (a: "useful" | "not_for_me") => {
    setFeedback(a);
    start(async () => {
      await briefingFeedbackAction(id, a);
    });
  };

  if (!open) {
    return (
      <p className="text-right">
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          Today&apos;s briefing
        </button>
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="todays-briefing">
      <div className="flex items-start gap-3">
        <StayfulEye size={40} level={eyeLevel} state={playing ? "thinking" : "idle"} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p id="todays-briefing" className="text-sm font-semibold text-foreground">
              {greeting}
            </p>
            <button type="button" onClick={dismiss} className="text-xs text-muted-foreground underline-offset-4 hover:underline" aria-label="Dismiss today's briefing">
              Dismiss
            </button>
          </div>
          <p className="mt-1 text-sm text-foreground">{opener}</p>
          {nudges.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {nudges.map((n) => (
                <li key={n.href}>
                  <span className="text-foreground">{n.text}</span>{" "}
                  <Link href={n.href} className="font-semibold text-primary underline-offset-4 hover:underline">
                    {n.nextStep}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {playLabel ? (
              <button type="button" onClick={play} className="rounded-md border border-border px-3 py-1.5 font-semibold text-foreground hover:bg-muted">
                {playing ? "Stop" : playLabel}
              </button>
            ) : null}
            <span className="text-muted-foreground">
              {feedback ? (
                feedback === "useful" ? "Thanks: marked useful." : "Thanks: noted."
              ) : (
                <>
                  <button type="button" onClick={() => answer("useful")} className="underline-offset-4 hover:underline">
                    Useful
                  </button>
                  {" · "}
                  <button type="button" onClick={() => answer("not_for_me")} className="underline-offset-4 hover:underline">
                    Not for me
                  </button>
                </>
              )}
            </span>
          </div>
          {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
        </div>
      </div>
    </section>
  );
}
