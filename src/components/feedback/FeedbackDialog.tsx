"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ImagePlus, Loader2, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { DEFAULT_SETTINGS, IMAGE, LIMITS, type ReportKind } from "@/lib/feedback/config";
import { FEEDBACK_EVENT, captureContext, newClientKey } from "@/lib/feedback/client";
import { fitToBudget, prepareImage, type PreparedImage } from "./shrink-image";

/**
 * The feedback form (Batch 18): a sheet from the bottom on a phone, a dialog
 * on a larger screen. Mounted once per page (AppShell, and the profile quiz)
 * and opened by any "Feedback" button through openFeedback(). The draft lives
 * here rather than in the popup, so tapping outside the sheet never loses
 * what the member typed; it is cleared once it has been sent.
 *
 * One tap sends it. The button is off while a send is in flight, and every
 * send carries a key: a retry of the same send (a double tap, a reply lost
 * on a bad connection) comes back as the same report on the server. Any
 * edit after a failed send makes a new key, so the edit is never mistaken
 * for the earlier send.
 */

interface Limits {
  dailyLimit: number;
  /** Null when it could not be read: the send is the check that counts. */
  remaining: number | null;
  maxScreenshots: number;
  screenshotMaxMb: number;
  textMax: number;
}

const DEFAULT_LIMITS: Limits = {
  dailyLimit: DEFAULT_SETTINGS.dailyLimit,
  remaining: null,
  maxScreenshots: DEFAULT_SETTINGS.maxScreenshots,
  screenshotMaxMb: DEFAULT_SETTINGS.screenshotMaxMb,
  textMax: LIMITS.textMax,
};

type Phase = "form" | "sending" | "sent";

const COPY = {
  bug: { label: "What went wrong?", placeholder: "What were you doing, and what happened?" },
  feature: { label: "What would you like?", placeholder: "What would make Stayful more useful to you?" },
} as const;

const IMAGE_ERRORS = {
  not_an_image: "That file isn’t a picture we can use. Screenshots have to be JPG, PNG or WebP.",
  unreadable: "We couldn’t read that picture. Please try another.",
} as const;

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ref: number; failed: number } | null>(null);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [limitReached, setLimitReached] = useState(false);
  const keyRef = useRef<string | null>(null);
  const contextRef = useRef<Record<string, unknown>>({});
  const inFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<PreparedImage[]>([]);
  imagesRef.current = images;

  const reset = useCallback(() => {
    for (const i of imagesRef.current) URL.revokeObjectURL(i.previewUrl);
    setKind(null);
    setText("");
    setImages([]);
    setImageError(null);
    setError(null);
    setResult(null);
    setPhase("form");
    keyRef.current = null;
  }, []);

  useEffect(() => {
    const onOpen = () => {
      contextRef.current = captureContext();
      setOpen(true);
      fetch("/api/feedback/open", { method: "POST", credentials: "same-origin" })
        .then(async (res) => {
          if (!res.ok) return;
          const d = (await res.json()) as Partial<Limits>;
          const next: Limits = {
            dailyLimit: typeof d.dailyLimit === "number" ? d.dailyLimit : DEFAULT_LIMITS.dailyLimit,
            remaining: typeof d.remaining === "number" ? d.remaining : null,
            maxScreenshots: typeof d.maxScreenshots === "number" ? d.maxScreenshots : DEFAULT_LIMITS.maxScreenshots,
            screenshotMaxMb: typeof d.screenshotMaxMb === "number" ? d.screenshotMaxMb : DEFAULT_LIMITS.screenshotMaxMb,
            textMax: typeof d.textMax === "number" ? d.textMax : DEFAULT_LIMITS.textMax,
          };
          setLimits(next);
          setLimitReached(next.remaining === 0);
        })
        .catch(() => undefined);
    };
    window.addEventListener(FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_EVENT, onOpen);
  }, []);

  useEffect(() => () => {
    for (const i of imagesRef.current) URL.revokeObjectURL(i.previewUrl);
  }, []);

  const onOpenChange = (next: boolean) => {
    if (next) return;
    if (inFlight.current) return;
    setOpen(false);
    // Sent: the next opening starts fresh. Not sent: the draft waits.
    if (phase === "sent") reset();
  };

  const edited = () => {
    keyRef.current = null;
    setError(null);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setImageError(null);
    edited();
    const room = limits.maxScreenshots - imagesRef.current.length;
    const picked = Array.from(list).slice(0, Math.max(0, room));
    if (list.length > room) setImageError(`Up to ${limits.maxScreenshots} screenshots, please.`);
    for (const file of picked) {
      setPreparing((n) => n + 1);
      try {
        const out = await prepareImage(file, limits.screenshotMaxMb * 1024 * 1024);
        if (out.ok) setImages((prev) => (prev.length < limits.maxScreenshots ? [...prev, out.image] : prev));
        else setImageError(out.error === "too_big" ? `That picture is over ${limits.screenshotMaxMb} MB. Try a screenshot instead.` : IMAGE_ERRORS[out.error]);
      } finally {
        setPreparing((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeImage = (index: number) => {
    edited();
    setImageError(null);
    setImages((prev) => {
      const gone = prev[index];
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const trimmed = text.trim();
  const canSend = phase === "form" && !limitReached && kind !== null && trimmed.length > 0 && preparing === 0;

  const send = async () => {
    if (inFlight.current || !canSend || !kind) return;
    inFlight.current = true;
    setPhase("sending");
    setError(null);
    try {
      const key = keyRef.current ?? newClientKey();
      keyRef.current = key;
      const ready = await fitToBudget(images, new TextEncoder().encode(text).length + 4096);
      if (!ready) {
        setError("Those screenshots are too big to send together. Please remove one and try again.");
        setPhase("form");
        return;
      }
      const form = new FormData();
      form.set("kind", kind);
      form.set("text", text);
      form.set("key", key);
      form.set("context", JSON.stringify(contextRef.current));
      ready.forEach((img, i) => form.append("screenshots", img.blob, `screenshot-${i + 1}.${img.type === "image/png" ? "png" : img.type === "image/webp" ? "webp" : "jpg"}`));
      let res: Response;
      try {
        res = await fetch("/api/feedback", { method: "POST", body: form, credentials: "same-origin" });
      } catch {
        setError("We couldn’t send that. Please check your connection and try again.");
        setPhase("form");
        return;
      }
      let data: { ok?: boolean; ref?: number; failed?: number; error?: string; message?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* Vercel's own refusals are not JSON */
      }
      if (res.ok && data.ok && typeof data.ref === "number") {
        setResult({ ref: data.ref, failed: data.failed ?? 0 });
        setPhase("sent");
        keyRef.current = null;
        return;
      }
      if (res.status === 429) setLimitReached(true);
      setError(res.status === 413 ? "That’s too much to send in one go. Please remove a screenshot and try again." : (data.message ?? "We couldn’t send that just now. Please try again."));
      setPhase("form");
    } finally {
      inFlight.current = false;
    }
  };

  const copy = COPY[kind ?? "bug"];
  const showCounter = text.length > limits.textMax * 0.8;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[110] bg-black/50 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-[110] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] text-[#2e3d2b] shadow-2xl transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,32rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0">
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#d6dccd] sm:hidden" />
          <div className="flex items-start justify-between gap-4 px-5 pt-3 sm:pt-5">
            <Dialog.Title className="text-lg font-semibold">{phase === "sent" ? "Thanks, we’ve got it." : "Send feedback"}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-[#7a8274] transition-colors hover:bg-[#f1f3ec] hover:text-[#2e3d2b] disabled:opacity-40" aria-label="Close" disabled={phase === "sending"}>
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {phase === "sent" && result ? (
            <div className="px-5 pb-5 pt-2">
              <p className="text-sm">
                Reference #{result.ref}. If we change something because of it, we’ll email you.
                {result.failed > 0 ? ` ${result.failed === 1 ? "One screenshot" : `${result.failed} screenshots`} couldn’t be attached.` : ""}
              </p>
              <Dialog.Close className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#2e3d2b] px-4 text-sm font-semibold text-white hover:opacity-90 sm:w-auto">Done</Dialog.Close>
            </div>
          ) : limitReached ? (
            <div className="px-5 pb-5 pt-2">
              <p className="text-sm">
                You’ve sent {limits.dailyLimit} today — the most we take in a day. Thank you! If it’s urgent, email{" "}
                <a href={`mailto:${BRAND.contactEmail}`} className="font-medium underline">
                  {BRAND.contactEmail}
                </a>
                .
              </p>
            </div>
          ) : (
            <form
              className="space-y-4 px-5 pb-5 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <div role="radiogroup" aria-label="What is it?" className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["bug", "Something’s broken"],
                    ["feature", "I have an idea"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    onClick={() => {
                      if (kind !== value) edited();
                      setKind(value);
                    }}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${kind === value ? "border-[#2e3d2b] bg-[#2e3d2b] text-white" : "border-[#d6dccd] bg-white text-[#2e3d2b] hover:bg-[#f1f3ec]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div>
                <label htmlFor="feedback-text" className="mb-1 block text-sm font-medium">
                  {copy.label}
                </label>
                <textarea
                  id="feedback-text"
                  rows={5}
                  maxLength={limits.textMax}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    edited();
                  }}
                  placeholder={copy.placeholder}
                  className="w-full resize-y rounded-xl border border-[#d6dccd] bg-white p-3 text-base leading-snug outline-none focus:border-[#5d8156] focus:ring-2 focus:ring-[#5d8156]/30"
                />
                {showCounter && (
                  <p className="mt-1 text-right text-xs text-[#7a8274]" aria-live="polite">
                    {text.length.toLocaleString("en-GB")} / {limits.textMax.toLocaleString("en-GB")}
                  </p>
                )}
              </div>

              {limits.maxScreenshots > 0 && (
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={IMAGE.types.join(",")}
                    multiple
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => void addFiles(e.target.files)}
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={images.length >= limits.maxScreenshots || preparing > 0 || phase !== "form"}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d6dccd] px-3 text-sm font-medium hover:bg-[#f1f3ec] disabled:opacity-50"
                    >
                      {preparing > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                      Add screenshots
                    </button>
                    <span className="text-xs text-[#7a8274]">
                      Optional · up to {limits.maxScreenshots}, {limits.screenshotMaxMb} MB each
                    </span>
                  </div>
                  {images.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {images.map((img, i) => (
                        <li key={img.previewUrl} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL), never optimised */}
                          <img src={img.previewUrl} alt={`Screenshot ${i + 1}`} className="h-20 w-20 rounded-lg border border-[#d6dccd] object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(i)}
                            disabled={phase !== "form"}
                            aria-label={`Remove screenshot ${i + 1}`}
                            className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#2e3d2b] text-white shadow disabled:opacity-50"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {imageError && (
                    <p className="mt-2 text-sm text-[#9a3412]" role="alert">
                      {imageError}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]" role="alert">
                  {error}
                </p>
              )}

              <div>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2e3d2b] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {phase === "sending" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {phase === "sending" ? "Sending…" : "Send"}
                </button>
                <p className="mt-2 text-xs text-[#7a8274]">We’ll also send the page you’re on and your browser and screen size, to help us look into it.</p>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
