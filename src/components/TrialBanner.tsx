import Link from "next/link";

// Sticky trial banner shown to logged-in, non-Pro users on the analyser.
// Counts down the remaining free reports and offers an upgrade CTA.
export function TrialBanner({ remaining }: { remaining: number }) {
  const urgent = remaining <= 1;

  return (
    <div
      className="sticky top-0 z-50 w-full border-b border-black/10 shadow-sm"
      style={{ backgroundColor: urgent ? "#b45309" : "rgb(93, 129, 86)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-center text-sm font-medium text-white">
        <span>
          {remaining <= 0
            ? "Your free reports are used up."
            : remaining === 1
              ? "⏳ You have 1 free report left on your trial."
              : `⏳ You have ${remaining} of 5 free reports left on your trial.`}
        </span>
        <Link
          href="/upgrade"
          className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-white/90"
          style={{ color: urgent ? "#b45309" : "rgb(93, 129, 86)" }}
        >
          Subscribe for unlimited reports
        </Link>
      </div>
    </div>
  );
}
