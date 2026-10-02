import Link from "next/link";
import { SAVED_STAGES, stageTotal } from "@/lib/home/figures";
import { TIME_SAVED_HOW, aboutFigure } from "@/lib/home/config";
import { PIPELINE_STATUSES } from "@/lib/listing/pipeline";
import { NAV_DESTINATIONS, NAV_TARGETS, EYE_NAV } from "@/lib/nav";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import type { HomeFigures, SavedFigure, StageCounts, Tile, TimeSavedFigure, TodayFigure } from "@/lib/home/types";
import { CountUp } from "./CountUp";
import { TapLink } from "./TapLink";

const DASH = "—";

const dayName = (ymd: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const pounds = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stageLabel = (s: string) => PIPELINE_STATUSES.find((p) => p.key === s)?.label ?? s;

/** Batch 22e: Home as drawn from its figures (src/lib/home). Every tile that could not be read shows "—". */
export function HomeView({ greeting, level, figures }: { greeting: string; level: EyeLevel; figures: HomeFigures }) {
  const { today, scanned, timeSaved, picked, saved, analyses, spent, feed } = figures;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
      <header className="flex items-center gap-3">
        <Link href={EYE_NAV.href} aria-label={EYE_NAV.label} className="shrink-0">
          <StayfulEye size={56} level={level} />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{greeting}</h1>
          <p className="text-sm text-muted-foreground">Here’s what Stayful Intelligence has done for you.</p>
        </div>
      </header>

      <TodayCard tile={today} />

      <section aria-label="What Stayful Intelligence has done for you" className="mt-6 grid gap-3 sm:grid-cols-2">
        <Figure
          tile={scanned}
          label="Properties scanned for you"
          value={(v) => v.total}
          note={(v) =>
            v.total === 0
              ? "We start counting from today."
              : `Since you joined on ${dayName(v.joinDay)}${v.countedFrom ? ` (counted from ${dayName(v.countedFrom)}, when we started recording)` : ""}, ${v.areas === "all" ? "across every area" : `in your ${v.areas} area${v.areas === 1 ? "" : "s"}`}.`
          }
          href={NAV_TARGETS.browse.href}
          target="tile:scanned"
        />
        <TimeSaved tile={timeSaved} />
        <Figure
          tile={picked}
          label="Deals picked for you"
          value={(v) => (v.active ?? v.all)}
          note={(v) => (v.all === 0 ? "Your first picks arrive with your Today’s 5." : v.active !== null ? `For this profile; ${v.all.toLocaleString("en-GB")} across all your profiles.` : "Today’s 5 and your first matches.")}
          href={NAV_TARGETS.browse.href}
          target="tile:picked"
        />
        <Figure
          tile={analyses}
          label="Analyses run"
          value={(v) => v.full + v.quick}
          note={(v) => (v.full + v.quick === 0 ? "Open a deal or run the Analyser and it shows here." : `${v.full.toLocaleString("en-GB")} full, ${v.quick.toLocaleString("en-GB")} quick.`)}
          href={NAV_TARGETS.analyser.href}
          target="tile:analyses"
        />
        {spent !== null && (
          <Figure
            tile={spent}
            label="Total spent"
            text={(v) => pounds(v.pence)}
            note={(v) => (v.pence === 0 ? "Nothing used yet." : "Credit used since you joined.")}
            href="/account/usage"
            target="tile:spent"
          />
        )}
      </section>

      <SavedDeals tile={saved} />

      <section aria-labelledby="this-week" className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 id="this-week" className="text-sm font-semibold text-foreground">This week</h2>
        {!feed.ok ? (
          <p className="mt-2 text-sm text-muted-foreground">{DASH}</p>
        ) : feed.value.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing yet this week. Your first Today’s 5 arrives at 7am.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {feed.value.map((item, i) => (
              <li key={`${item.at}-${i}`}>
                <TapLink href={item.href} target={item.target} className="block py-2 text-sm text-foreground underline-offset-4 hover:underline">
                  {item.text}
                </TapLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function TodayCard({ tile }: { tile: Tile<TodayFigure> }) {
  return (
    <section aria-labelledby="todays-5" className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
      <h2 id="todays-5" className="text-xs font-semibold uppercase tracking-wide text-primary">
        Today’s 5{tile.ok && tile.value.profileName ? ` · ${tile.value.profileName}` : ""}
      </h2>
      {!tile.ok ? (
        <p className="mt-2 text-3xl font-semibold text-foreground">{DASH}</p>
      ) : tile.value.paused ? (
        <p className="mt-2 text-base text-foreground">Daily deals for this profile are paused.</p>
      ) : !tile.value.ready ? (
        <p className="mt-2 text-base text-foreground">Your Today’s 5 are on their way: they’re picked each morning at 7am.</p>
      ) : tile.value.done ? (
        <p className="mt-2 text-base text-foreground">
          All done for today: {tile.value.kept} kept, {tile.value.passed} passed.
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            <CountUp value={tile.value.waiting} /> <span className="text-base font-medium text-muted-foreground">waiting for you</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tile.value.kept} kept · {tile.value.passed} passed · {tile.value.size} today
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-label="Keep or Pass progress" aria-valuemin={0} aria-valuemax={tile.value.size} aria-valuenow={tile.value.kept + tile.value.passed}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${tile.value.size > 0 ? Math.round(((tile.value.kept + tile.value.passed) / tile.value.size) * 100) : 0}%` }} />
          </div>
        </>
      )}
      <TapLink href={NAV_DESTINATIONS.today()} target="tile:today" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
        Go to Today
      </TapLink>
    </section>
  );
}

function Figure<T>({ tile, label, value, text, note, href, target }: { tile: Tile<T>; label: string; value?: (v: T) => number; text?: (v: T) => string; note: (v: T) => string; href: string; target: string }) {
  return (
    <TapLink href={href} target={target} className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{!tile.ok ? DASH : value ? <CountUp value={value(tile.value)} /> : text ? text(tile.value) : DASH}</p>
      {tile.ok && <p className="mt-1 text-xs text-muted-foreground">{note(tile.value)}</p>}
    </TapLink>
  );
}

function TimeSaved({ tile }: { tile: Tile<TimeSavedFigure> }) {
  const fig = tile.ok ? aboutFigure(tile.value.minutes) : null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time saved</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">
        {!tile.ok ? (
          DASH
        ) : fig ? (
          <>
            <span className="text-base font-medium text-muted-foreground">about </span>
            <CountUp value={fig.value} /> <span className="text-base font-medium text-muted-foreground">{fig.unit === "hours" ? (fig.value === 1 ? "hour" : "hours") : fig.value === 1 ? "minute" : "minutes"}</span>
          </>
        ) : (
          <span className="text-base font-medium text-muted-foreground">Starts with your first scan</span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">How we work this out: {TIME_SAVED_HOW}</p>
    </div>
  );
}

function SavedDeals({ tile }: { tile: Tile<SavedFigure> }) {
  const counts: StageCounts | null = tile.ok ? tile.value.active ?? tile.value.all : null;
  const profileId = tile.ok && tile.value.active ? tile.value.activeProfileId : null;
  return (
    <section aria-labelledby="saved-deals" className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="saved-deals" className="text-sm font-semibold text-foreground">Saved deals</h2>
        {tile.ok && tile.value.active && <p className="text-xs text-muted-foreground">This profile · {stageTotal(tile.value.all).toLocaleString("en-GB")} across all</p>}
      </div>
      {!counts ? (
        <p className="mt-2 text-2xl font-semibold text-foreground">{DASH}</p>
      ) : stageTotal(counts) === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No saved deals yet. Keep one from Today’s 5 and it shows here.</p>
      ) : (
        <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SAVED_STAGES.map((stage) => (
            <li key={stage}>
              <TapLink href={NAV_DESTINATIONS.myDealsStage(stage, profileId)} target={`tile:${stage}`} className="block rounded-lg border border-border p-3 text-center hover:border-primary/40">
                <span className="block text-xl font-semibold text-foreground">
                  <CountUp value={counts[stage]} />
                </span>
                <span className="block text-xs text-muted-foreground">{stageLabel(stage)}</span>
              </TapLink>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
