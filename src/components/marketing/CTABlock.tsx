import Link from "next/link";
import { CTA } from "@/lib/cta";

export function CTABlock({
  heading,
  body,
  variant = "default",
  showSecondary = true,
}: {
  heading?: string;
  body?: string;
  variant?: "default" | "green";
  showSecondary?: boolean;
}) {
  const className = variant === "green" ? "sf-cta-block sf-cta-block--green" : "sf-cta-block";
  const primaryButtonClass = variant === "green" ? "sf-btn sf-btn--white" : "sf-btn";
  return (
    <div className={className}>
      {heading ? <h2>{heading}</h2> : null}
      {body ? <p>{body}</p> : null}
      <div className="sf-cta-block__buttons">
        <Link href={CTA.primaryHref} className={primaryButtonClass}>
          {CTA.primary}
        </Link>
        {showSecondary ? (
          <Link
            href={CTA.secondaryHref}
            className={variant === "green" ? "sf-btn sf-btn--ghost" : "sf-btn sf-btn--ghost"}
            style={variant === "green" ? { borderColor: "#fff", color: "#fff" } : undefined}
          >
            {CTA.secondary}
          </Link>
        ) : null}
      </div>
      <p className="sf-cta-block__note">{CTA.trialNote}</p>
    </div>
  );
}
