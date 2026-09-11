// Sticky banner shown on the analyser to accounts that are NOT subscribers.
//
// `remaining` is `number | null` on purpose: freeReportsRemaining() returns
// null for anyone who isn't on the usage-based free trial, so free-trial copy
// ("you have N free reports left") is structurally impossible to render to a
// paying customer or a lapsed subscriber — there is no number to render.
export function TrialBanner({
  variant,
  remaining,
  checkoutHref,
  pausedUntil = null,
}: {
  variant: "free_trial" | "lapsed" | "paused";
  remaining: number | null;
  checkoutHref: string;
  /** Pre-formatted resume date, server-side. Only used by the paused variant. */
  pausedUntil?: string | null;
}) {
  const paused = variant === "paused";
  const lapsed = variant === "lapsed";
  const urgent = lapsed || (!paused && (remaining ?? 0) <= 1);

  const message = paused
    ? pausedUntil
      ? `Your plan is paused until ${pausedUntil}.`
      : "Your plan is paused."
    : lapsed
      ? "Your subscription has ended — reports are paused."
      : remaining === null || remaining <= 0
        ? "Your free reports are used up."
        : remaining === 1
          ? "⏳ You have 1 free report left on your trial."
          : `⏳ You have ${remaining} of 5 free reports left on your trial.`;

  // A paused member already has a subscription. Sending them to checkout would
  // start a SECOND one and bill them twice, so their only CTA is /account.
  const href = paused ? "/account" : checkoutHref;
  const cta = paused
    ? "Resume my plan"
    : lapsed
      ? "Re-subscribe"
      : "Subscribe for unlimited reports";

  const background = urgent ? "#b45309" : "rgb(93, 129, 86)";

  return (
    <div
      className="sticky top-0 z-50 w-full border-b border-black/10 shadow-sm"
      style={{ backgroundColor: background }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-center text-sm font-medium text-white">
        <span>{message}</span>
        <a
          href={href}
          className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-white/90"
          style={{ color: background }}
        >
          {cta}
        </a>
      </div>
    </div>
  );
}
