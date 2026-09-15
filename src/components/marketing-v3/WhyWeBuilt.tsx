// Used on the landing page (after the accuracy ledger) and on /methodology.
// The "landing" variant adds the sentence that ties the operator story to the
// ledger above it; elsewhere there is no ledger, so it stays off.

export function WhyWeBuilt({
  variant = "default",
}: {
  variant?: "default" | "landing";
}) {
  return (
    <section className="why-built section-tight">
      <div className="wrap-narrow">
        <div className="eyebrow">
          {variant === "landing" ? "Why we can do this" : "Why we built this"}
        </div>
        <h2>We&apos;re a management company first.</h2>
        <p className="lede">
          Stayful runs short-lets for owners across the UK. Every week we get
          the same question from people thinking about turning a property into
          a short-let — what could it actually earn? The Analyser is our
          answer: the same model we use to estimate income before we take a
          property under management, now available to anyone who needs that
          decision in 20 seconds rather than on a sales call.
        </p>
        {variant === "landing" && (
          <p className="lede">
            It is also the reason the ledger above can exist. We don&rsquo;t
            have to guess whether the model was right, because we run the
            properties and find out.
          </p>
        )}
      </div>
    </section>
  );
}
