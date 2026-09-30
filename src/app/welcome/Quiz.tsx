"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notifyCreditChanged } from "@/lib/credit/client";
import { answerLabel, currentValue, imageOf, optionsOf, questionById, text, type Answers, type Question, type QuestionId, type WhereAnswer } from "@/lib/profile/questions";
import { minutesLeftLabel, pillLabel } from "@/lib/profile/state";
import { matchLabel } from "@/lib/profile/matching";
import type { QuizArea } from "@/lib/onboarding/server";
import type { CreditView, ProgressView, SampleDeal } from "@/lib/profile/server";
import { answerQuestionAction, finishLaterAction, previewMatchCountAction, sampleMatchesAction } from "./actions";
import { QuizPhoto } from "./_components/QuizPhoto";
import { AmountChoice, AreasChoice, FinanceChoice, MultiChoice, PROFIT_INPUT, PrimaryButton, RENT_INPUT, SingleChoice, WhereChoice } from "./_components/Controls";
import { SampleDeals } from "./_components/SampleDeals";
import { SignupConsentCheckbox } from "@/components/tracking/SignupConsentCheckbox";
import { StarterPackOffer } from "@/components/starter-pack/StarterPackOffer";
import { packNotNowAction, packShownAction } from "@/components/starter-pack/actions";
import type { PackCopy } from "@/lib/starter-pack/rules";

export interface QuizStart {
  answers: Answers;
  progress: ProgressView;
  matchCount: number | null;
  credit: CreditView;
  /** `?q=`: one question to change, then back to `returnTo`. */
  editing: QuestionId | null;
  /** Where "Finish later" and the end go back to. */
  returnTo: string;
  /** A member who has answered nothing yet sees the start screen first. */
  fresh: boolean;
  /** Batch 19: the start screen offers the Meta pixel checkbox (a new Google sign-up). */
  consentCheckbox?: boolean;
  areas: QuizArea[];
  /** Batch 20: the starter pack, offered once the welcome questions are answered (eligible new members only). */
  pack?: { copy: PackCopy; returnTo: string } | null;
  profileHref: string;
  privacyHref: string;
  todayHref: string;
}

type Screen = { kind: "start" } | { kind: "question"; id: QuestionId } | { kind: "samples"; then: QuestionId } | { kind: "pack"; view: { progress: ProgressView; answers: Answers }; listBefore: string } | { kind: "done" };

/**
 * The quiz: one question per screen, big tap cards, every answer saved at
 * once (actions.ts → src/lib/profile/server.ts). The rules — which questions,
 * what comes next, the bar — are the pure modules'; this only draws them
 * and moves between screens.
 */
export function Quiz(start: QuizStart) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(start.answers);
  const [progress, setProgress] = useState<ProgressView>(start.progress);
  const [matchCount, setMatchCount] = useState<number | null>(start.matchCount);
  const [credit, setCredit] = useState<CreditView>(start.credit);
  const [editing, setEditing] = useState<QuestionId | null>(start.editing);
  const [screen, setScreen] = useState<Screen>(() => (start.editing ? { kind: "question", id: start.editing } : start.fresh ? { kind: "start" } : start.progress.next ? { kind: "question", id: start.progress.next } : { kind: "done" }));
  const [samples, setSamples] = useState<SampleDeal[] | null>(null);
  const [samplesShown, setSamplesShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Scroll to the top of each new screen: on a phone the answer cards are below the fold.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {
      /* ignore */
    }
  }, [screen]);

  const isLast = (id: QuestionId, questions: QuestionId[]) => questions[questions.length - 1] === id;

  const advance = useCallback(
    (view: { progress: ProgressView; answers: Answers }, wasEditing: QuestionId | null, listBefore: string) => {
      if (wasEditing) {
        // Back to the page they came from, unless the change (a role, a deal type) opened questions to answer.
        const listChanged = view.progress.questions.join() !== listBefore;
        if (view.progress.complete || !listChanged) {
          router.push(start.returnTo);
          return;
        }
        setEditing(null);
      }
      const next = view.progress.next;
      if (!next) {
        setScreen({ kind: "done" });
        return;
      }
      if (isLast(next, view.progress.questions) && !samplesShown) {
        setSamplesShown(true);
        setSamples(null);
        setScreen({ kind: "samples", then: next });
        sampleMatchesAction()
          .then(setSamples)
          .catch(() => setSamples([]));
        return;
      }
      setScreen({ kind: "question", id: next });
    },
    [router, samplesShown, start.returnTo],
  );

  const answer = (id: QuestionId, value: unknown, notSure: boolean) => {
    setError(null);
    setWarning(null);
    const wasEditing = editing;
    const listBefore = progress.questions.join();
    startTransition(async () => {
      const r = await answerQuestionAction({ questionId: id, value, notSure, editing: wasEditing !== null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAnswers(r.view.answers);
      setProgress(r.view.progress);
      setMatchCount(r.view.matchCount);
      if (r.view.credit.paid && !credit.paid) notifyCreditChanged();
      setCredit(r.view.credit);
      if (r.warning) setWarning(r.warning);
      // Batch 20: the answer that opens the app offers the starter pack first, once; "Not now" carries on.
      if (start.pack && !wasEditing && !progress.mandatoryDone && r.view.progress.mandatoryDone) {
        setScreen({ kind: "pack", view: r.view, listBefore });
        return;
      }
      advance(r.view, wasEditing, listBefore);
    });
  };

  // Stable, so the where-control's debounce effect does not re-arm on every render.
  const preview = useCallback((where: WhereAnswer) => {
    previewMatchCountAction(where)
      .then((n) => {
        if (n !== null) setMatchCount(n);
      })
      .catch(() => {});
  }, []);

  const finishLater = (id: QuestionId) => {
    startTransition(async () => {
      await finishLaterAction(id).catch(() => {});
      router.push(start.returnTo);
    });
  };

  if (screen.kind === "start") {
    return (
      <Frame>
        <QuizPhoto image="start" priority />
        <h1 className="mt-5 text-2xl font-semibold text-foreground">Let’s build your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          One question per screen, {minutesLeftLabel(progress.minutesLeft).replace(" left", "")}. Every answer makes the deals we show you more yours{credit.pence > 0 ? `, and there is £${(credit.pence / 100).toFixed(0)} of credit when you finish` : ""}.
        </p>
        <div className="mt-5">
          <PrimaryButton onClick={() => setScreen(progress.next ? { kind: "question", id: progress.next } : { kind: "done" })}>Start</PrimaryButton>
        </div>
        {start.consentCheckbox ? (
          <div className="mt-4">
            <SignupConsentCheckbox instant />
          </div>
        ) : null}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Your answers only decide which deals you see and in what order. See our{" "}
          <Link href={start.privacyHref} className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      </Frame>
    );
  }

  if (screen.kind === "done") {
    return (
      <Frame>
        <QuizPhoto image="done" priority />
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-primary">Profile 100%</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">That’s everything. Nice work.</h1>
        {credit.line && <p className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${credit.paid ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>{credit.line}</p>}
        {matchCount !== null && <p className="mt-3 text-sm text-muted-foreground">{matchLabel(matchCount, false)}. From tomorrow, your Today’s 5 is picked from them.</p>}
        <div className="mt-5 space-y-3">
          <PrimaryButton onClick={() => router.push(start.todayHref)}>See your Today’s 5</PrimaryButton>
          <Link href={start.profileHref} className="block text-center text-sm font-medium text-foreground underline-offset-4 hover:underline">
            Review your answers
          </Link>
        </div>
      </Frame>
    );
  }

  if (screen.kind === "pack") {
    const carryOn = () => advance(screen.view, null, screen.listBefore);
    if (!start.pack) return null;
    return (
      <Frame>
        <PackScreen
          pack={start.pack}
          onNotNow={() => {
            packNotNowAction("welcome").catch(() => {});
            carryOn();
          }}
          onContinue={carryOn}
        />
      </Frame>
    );
  }

  if (screen.kind === "samples") {
    return (
      <Frame>
        <ProgressHeader progress={progress} matchCount={matchCount} />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Deals that match you so far</h1>
        <p className="mt-1 text-sm text-muted-foreground">A taste of what your Today’s 5 will be picked from. One more question and you’re done.</p>
        <div className="mt-4">{samples === null ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Finding your matches…</p> : <SampleDeals deals={samples} />}</div>
        <div className="mt-5">
          <PrimaryButton onClick={() => setScreen({ kind: "question", id: screen.then })}>Last question</PrimaryButton>
        </div>
      </Frame>
    );
  }

  const q = questionById(screen.id);
  if (!q) return null;
  const image = imageOf(q, answers);
  const value = currentValue(q.id, answers);
  const showFinishLater = !editing && progress.mandatoryDone;

  return (
    <Frame>
      <ProgressHeader progress={progress} matchCount={matchCount} />
      {image !== "cards" && (
        <div className="mt-4">
          <QuizPhoto image={image} priority />
        </div>
      )}
      <p className="mt-4 text-xs font-medium text-muted-foreground">
        <span className="font-semibold text-primary">Why we ask</span> · {text(q.why, answers)}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">{text(q.title, answers)}</h1>
      <div className="mt-4">
        <Control q={q} answers={answers} value={value} areas={start.areas} busy={busy} onAnswer={(v) => answer(q.id, v, false)} onPreview={preview} />
      </div>
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {warning && <p className="mt-3 text-sm text-muted-foreground">{warning}</p>}
      {!q.mandatory && (
        <button type="button" disabled={busy} onClick={() => answer(q.id, null, true)} className="mt-3 min-h-12 w-full rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
          Not sure
        </button>
      )}
      <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
        {editing ? (
          <Link href={start.returnTo} className="underline-offset-4 hover:underline">
            Back without changing
          </Link>
        ) : showFinishLater ? (
          <button type="button" disabled={busy} onClick={() => finishLater(q.id)} className="underline-offset-4 hover:underline">
            Finish later
          </button>
        ) : (
          <span />
        )}
        {value !== null && value !== undefined && !editing && (
          <span className="truncate pl-3" title={answerLabel(q.id, answers) ?? undefined}>
            Answered: {answerLabel(q.id, answers)}
          </span>
        )}
      </div>
    </Frame>
  );
}

/** Batch 20: the starter pack between the welcome questions and the rest. "Not now" goes on with the quiz; Today keeps the offer. */
function PackScreen({ pack, onNotNow, onContinue }: { pack: { copy: PackCopy; returnTo: string }; onNotNow: () => void; onContinue: () => void }) {
  useEffect(() => {
    packShownAction("welcome").catch(() => {});
  }, []);
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">You’re in</p>
      <div className="mt-1">
        <StarterPackOffer copy={pack.copy} returnTo={pack.returnTo} variant="screen" onNotNow={onNotNow} onContinue={onContinue} continueLabel="Carry on with your profile" />
      </div>
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">{children}</div>;
}

/** "Profile 45%", the bar, "about 3 minutes left", and the live count. */
function ProgressHeader({ progress, matchCount }: { progress: ProgressView; matchCount: number | null }) {
  const line = matchLabel(matchCount, !progress.complete);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="text-primary">{pillLabel(progress)}</span>
        {progress.minutesLeft > 0 && <span className="normal-case tracking-normal">{minutesLeftLabel(progress.minutesLeft)}</span>}
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile progress">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
      </div>
      {line && (
        <p className="mt-2 text-sm font-medium text-foreground" aria-live="polite">
          {line}
        </p>
      )}
    </div>
  );
}

/** The right control for the question's kind. */
function Control({ q, answers, value, areas, busy, onAnswer, onPreview }: { q: Question; answers: Answers; value: unknown; areas: QuizArea[]; busy: boolean; onAnswer: (v: unknown) => void; onPreview: (w: WhereAnswer) => void }) {
  const options = optionsOf(q, answers);
  switch (q.kind) {
    case "single":
    case "budget":
      return <SingleChoice options={options} value={typeof value === "string" ? value : null} onPick={onAnswer} busy={busy} />;
    case "multi":
      return <MultiChoice options={options} value={Array.isArray(value) ? (value as string[]) : []} onSubmit={onAnswer} busy={busy} allValue={q.allOption} />;
    case "where":
      return <WhereChoice options={options} value={(value as WhereAnswer | null) ?? null} areas={areas} onSubmit={onAnswer} onPreview={onPreview} busy={busy} />;
    case "rent":
      return <AmountChoice presets={q.presets ?? []} value={typeof value === "number" ? value : null} {...RENT_INPUT} suffix=" a month" placeholder="1,250" onSubmit={onAnswer} busy={busy} />;
    case "profit":
      return <AmountChoice presets={q.presets ?? []} value={typeof value === "number" ? value : null} {...PROFIT_INPUT} suffix=" a month" placeholder="500" onSubmit={onAnswer} busy={busy} />;
    case "finance":
      return <FinanceChoice value={(value as { depositPct: number; mortgageRatePct: number } | null) ?? { depositPct: 25, mortgageRatePct: 5.5 }} onSubmit={onAnswer} busy={busy} />;
    case "areas":
      return <AreasChoice areas={areas} value={Array.isArray(value) ? (value as string[]) : []} onSubmit={onAnswer} busy={busy} label={q.id === "unit_areas" ? "Where your units are" : "Your cities"} />;
  }
}
