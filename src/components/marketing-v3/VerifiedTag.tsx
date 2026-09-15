// One marker, one grammar, used everywhere provenance is claimed:
//   solid dot   = observed (we took the booking, or a partner recorded it)
//   hollow dot  = modelled (derived, not witnessed)
// Deliberately no icon — a shield or tick reads as SaaS decoration; a dot
// reads as an instrument panel, which is the register the page wants.

export type VerifiedTone = "operated" | "partner" | "modelled";

export function VerifiedTag({
  tone,
  label,
}: {
  tone: VerifiedTone;
  label: string;
}) {
  return (
    <span className={`verified verified--${tone}`}>
      <span className="verified-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
