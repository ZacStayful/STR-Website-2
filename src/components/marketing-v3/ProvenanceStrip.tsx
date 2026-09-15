import Link from "next/link";
import { TRUST } from "@/lib/brand";

// Server component, passed into the client <Hero> as children so that
// brand.ts never enters the client bundle. Next's docs call this the "slot"
// pattern; the RSC payload holds the rendered output, not the module.

const MARKS = [
  { num: TRUST.propertiesManaged, label: "properties we manage" },
  { num: TRUST.revenueEarned, label: "owner revenue booked" },
  { num: TRUST.googleRating, label: "average owner rating" },
];

export function ProvenanceStrip() {
  return (
    <div className="prov-strip">
      <p className="prov-strip-line">
        Other tools model the market. <strong>We also operate in it.</strong>
      </p>
      <div className="prov-strip-marks">
        {MARKS.map((m) => (
          <div key={m.label} className="prov-mark">
            <span className="prov-mark-num">{m.num}</span>
            <span className="prov-mark-label">{m.label}</span>
          </div>
        ))}
        <Link className="prov-strip-link" href="/methodology">
          Forecast vs actual, published →
        </Link>
      </div>
    </div>
  );
}
