import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import type { Answer } from "@/lib/intelligence/answers";
import type { RevealTone } from "@/lib/intelligence/reveal";
import { revealIntro } from "@/lib/intelligence/reveal";
import { AnswerChips } from "./AnswerChips";
import { ViewBackground } from "./ViewBackground";
import { ChatEye } from "./chat/ChatEye";

/**
 * Batch 22, Part E: the Stayful Intelligence view, full screen on the header's
 * dark brand surface. Used by the signup reveal and by /intelligence (the
 * header eye). Server-rendered: the cards, Save and Continue are there on
 * first paint; the eye is CSS-only; nothing types itself out or waits.
 *
 * The "ask" region at the bottom holds the question chips and a reserved slot
 * for Batch 26's typed chat (#si-chat-slot), so adding the text box later moves
 * nothing above it.
 */
const ON_DARK = {
  "--si-eye": "#8ab382",
  "--si-eye-bright": "#b5d9ab",
  "--si-eye-glow": "#1a3018",
  "--si-eye-iris": "#2e3d2b",
  "--si-eye-iris-deep": "#0f150e",
} as CSSProperties;

export interface IntelligenceViewProps {
  surface: "reveal" | "header";
  continueHref: string;
  continueLabel: string;
  level: EyeLevel;
  levelName: string;
  nextLevel: { name: string; needed: number } | null;
  tone: RevealTone;
  cardCount: number;
  checkedText: string | null;
  /** The best match's card, and the alternatives' (rendered by the page: Today's own DealCard). */
  best: ReactNode;
  alternatives: ReactNode[];
  /** "Save all 3" (the reveal only), a plain form. */
  saveAll?: ReactNode;
  /** Part F's suggestions, when the match is low or there is none. */
  whatIfs?: ReactNode;
  /** The line under the cards: a search still running, a status. */
  note?: ReactNode;
  answers: Answer[];
  savedAll?: boolean;
  /** Batch 26: the typed chat's box, in the reserved slot under the chips (the header view only). */
  chat?: ReactNode;
}

export function IntelligenceView(p: IntelligenceViewProps) {
  const closest = p.tone === "closest";
  return (
    <div className="min-h-screen bg-[#2E3D2B] text-white" style={ON_DARK}>
      <ViewBackground level={p.level} />
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-[#2E3D2B]/95 px-4 py-2 backdrop-blur">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <StayfulEye size={24} level={p.level} />
          <span className="hidden sm:inline">Stayful Intelligence</span>
        </span>
        <Link href={p.continueHref} className="rounded-full bg-[#B9D5C6] px-4 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90">
          {p.continueLabel}
        </Link>
      </div>

      <main className="relative z-10 mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-6">
        <header className="flex flex-col items-center text-center">
          <div className="hidden sm:block">
            <ChatEye size={180} level={p.level} label={`Stayful Intelligence, ${p.levelName}`} />
          </div>
          <div className="sm:hidden">
            <ChatEye size={120} level={p.level} label={`Stayful Intelligence, ${p.levelName}`} />
          </div>
          {p.tone !== "none" && <h1 className="mt-6 text-2xl font-semibold">{closest ? "This is the closest I have today." : revealIntro(p.cardCount)}</h1>}
          {p.tone === "none" && <h1 className="mt-6 text-2xl font-semibold">I couldn’t find a close match for everything you asked for.</h1>}
          {p.checkedText && <p className="mt-2 max-w-xl text-sm text-[#B9D5C6]">{p.checkedText}</p>}
          {p.savedAll && <p className="mt-2 text-sm font-semibold text-[#B9D5C6]" role="status">All 3 saved. I’ll watch them for you.</p>}
        </header>

        {p.cardCount > 0 && (
          <section aria-labelledby="si-best">
            <h2 id="si-best" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#B9D5C6]">
              {closest ? "The closest I have today" : "Your best match right now"}
            </h2>
            <div className="rounded-2xl bg-background text-foreground">{p.best}</div>
          </section>
        )}

        {p.alternatives.length > 0 && (
          <section aria-labelledby="si-alts">
            <h2 id="si-alts" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#B9D5C6]">
              {p.alternatives.length === 1 ? "1 close alternative" : `${p.alternatives.length} close alternatives`}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {p.alternatives.map((a, i) => (
                <div key={i} className="rounded-2xl bg-background text-foreground">
                  {a}
                </div>
              ))}
            </div>
          </section>
        )}

        {p.saveAll}
        {p.note}
        {p.whatIfs}

        {p.nextLevel && (
          <p className="rounded-xl bg-white/5 p-4 text-sm text-[#d0d6ba]">
            I’m at {p.levelName} accuracy. Answer {p.nextLevel.needed} more question{p.nextLevel.needed === 1 ? "" : "s"} and my picks get sharper.{" "}
            <Link href="/welcome" className="font-semibold text-white underline underline-offset-4">
              Keep going
            </Link>
          </p>
        )}

        <section aria-labelledby="si-ask" className="space-y-3 border-t border-white/10 pt-6">
          <h2 id="si-ask" className="text-base font-semibold">
            Anything you’d like to ask me?
          </h2>
          <AnswerChips answers={p.answers} surface={p.surface} />
          {/* Batch 26's typed chat: the slot was reserved so nothing above moves. */}
          <div id="si-chat-slot">{p.chat}</div>
        </section>

        <p className="text-center text-xs text-[#B9D5C6]/80">Stayful Intelligence is software, not a person. I describe deals; the decision is yours.</p>
      </main>
    </div>
  );
}
