/**
 * Qualification decision screen — shown FIRST, before any detailed numbers.
 *
 * The detailed report is revealed via "See the full breakdown". Every monetary
 * figure here shows BOTH annual and monthly. All numbers derive from the
 * server-computed `recommendation` and the decision maths in lib/qualification.
 */

import { CheckCircle2, ArrowRight, Phone, Sparkles } from "lucide-react";
import type { Recommendation } from "@/lib/qualification";
import { MARGIN_THRESHOLD, LL_AGENT_FEE } from "@/lib/qualification";
import { TakeHomeBridge } from "./TakeHomeBridge";

function gbpYr(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}/yr`;
}
function gbpMo(value: number): string {
  return `£${Math.round(value / 12).toLocaleString("en-GB")}/mo`;
}

const CALENDLY_URL = "https://calendly.com/zac-stayful/call";

interface DecisionScreenProps {
  recommendation: Recommendation;
  grossSTRAnnual: number;
  onSeeBreakdown: () => void;
  onBookCall?: () => void;
}

export function DecisionScreen({ recommendation, grossSTRAnnual, onSeeBreakdown, onBookCall }: DecisionScreenProps) {
  const { recommendation: verdict, upliftPct, trueSTRNet, trueLLNet, longLetSource } = recommendation;
  const isShortLet = verdict === "SHORT_LET";

  // Headline comparison — the true uplift, signed in favour of the winner.
  const diff = trueSTRNet - trueLLNet;
  const absDiff = Math.abs(diff);
  const upliftPctLabel = `${upliftPct >= 0 ? "+" : ""}${Math.round(upliftPct * 100)}%`;

  // Criteria maths (§6): the 50% bar comes straight from MARGIN_THRESHOLD.
  const required = trueLLNet * (1 + MARGIN_THRESHOLD);
  const clearsBar = trueSTRNet >= required;
  const shortfall = Math.max(0, required - trueSTRNet);

  // Honest money-led sub-line.
  const subLine = isShortLet
    ? `${gbpYr(absDiff)} (${gbpMo(absDiff)}) more in your pocket (${upliftPctLabel})`
    : diff >= 0
      ? `Short-let adds just ${gbpYr(absDiff)} (${gbpMo(absDiff)}) — not enough to justify the extra work (${upliftPctLabel})`
      : `Long-let leaves you ${gbpYr(absDiff)} (${gbpMo(absDiff)}) more`;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        {/* 1. Headline band */}
        <div
          className={`rounded-2xl p-6 sm:p-8 ${
            isShortLet ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"
          }`}
        >
          <div className="flex items-center gap-2">
            {isShortLet ? (
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className={`text-sm font-medium ${isShortLet ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
              Your recommendation
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {isShortLet ? "Short-Let Recommended" : "Long-Let Recommended"}
          </h1>
          <p className={`mt-2 text-base sm:text-lg ${isShortLet ? "text-primary-foreground/90" : "text-muted-foreground"}`}>
            {subLine}
          </p>
        </div>

        {/* 2. Net difference callout */}
        <div className="mt-5 rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {isShortLet ? "In favour of short-let" : diff >= 0 ? "In favour of short-let" : "In favour of long-let"}
          </p>
          <p className={`mt-1 text-4xl font-bold sm:text-5xl ${isShortLet ? "text-success" : "text-foreground"}`}>
            {diff >= 0 ? "+" : "−"}
            {gbpYr(absDiff)}
          </p>
          <p className="mt-1 text-lg font-semibold text-muted-foreground">
            {diff >= 0 ? "+" : "−"}
            {gbpMo(absDiff)}
          </p>
        </div>

        {/* 6. Estimated-figure note */}
        {longLetSource !== "user" && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {longLetSource === "estimate"
              ? "Your long-let rent was estimated for you."
              : "Your long-let rent was estimated from local market data."}{" "}
            For the most accurate decision, tell us what it would rent for.
          </p>
        )}

        {/* 3. Take-home waterfall bridge */}
        <div className="mt-6">
          <TakeHomeBridge
            grossSTRAnnual={grossSTRAnnual}
            longLetNetAnnual={trueLLNet}
            longLetFeePct={LL_AGENT_FEE}
          />
        </div>

        {/* 4. "How we decide" criteria box */}
        <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5 sm:p-6">
          <h2 className="mb-2 text-sm font-bold text-foreground">How we decide</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Short-letting takes more work, cost and risk than a long-let, so we only recommend it when it
            leaves you at least <span className="font-semibold text-foreground">{Math.round(MARGIN_THRESHOLD * 100)}% more</span>{" "}
            after all running costs (platform &amp; management fees, cleaning, maintenance, bills and software).
            A managed long-let here leaves{" "}
            <span className="font-semibold text-foreground">
              {gbpYr(trueLLNet)} ({gbpMo(trueLLNet)})
            </span>
            , so short-let needs to clear{" "}
            <span className="font-semibold text-foreground">
              {gbpYr(required)} ({gbpMo(required)})
            </span>{" "}
            to be worth it. Yours comes out at{" "}
            <span className="font-semibold text-foreground">
              {gbpYr(trueSTRNet)} ({gbpMo(trueSTRNet)})
            </span>{" "}
            —{" "}
            {clearsBar ? (
              <span className="font-semibold text-success">it clears the bar.</span>
            ) : (
              <span className="font-semibold text-foreground">about {gbpYr(shortfall)} short.</span>
            )}
          </p>
        </div>

        {/* 5. Buttons */}
        <div className="mt-7 space-y-3">
          {isShortLet ? (
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onBookCall}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Book a call
            </a>
          ) : (
            <div className="rounded-lg border border-border bg-card px-5 py-4 text-center text-sm leading-relaxed text-muted-foreground">
              Based on your numbers, short-let isn&apos;t the right fit right now — but circumstances change.
              We&apos;ll keep your report on file.
            </div>
          )}

          <button
            type="button"
            onClick={onSeeBreakdown}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            See the full breakdown
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
}
