import {
  PROVENANCE_PILLARS,
  FIRST_PARTY_SOURCES,
  EXTERNAL_SOURCES,
} from "@/lib/provenance-data";
import { VerifiedTag } from "./VerifiedTag";

// Replaces StatsBar. Keeps the dark band's place in the page rhythm
// (cream -> dark -> cream) and its CSS, but says something load-bearing
// instead of four vanity stats that were already stated elsewhere.

export function ProvenanceBar() {
  return (
    <section className="prov-bar" id="provenance">
      <div className="wrap">
        <div className="prov-bar-head">
          <div className="eyebrow">Where the numbers come from</div>
          <h2>
            Everyone models the market.
            <br />
            We also book it.
          </h2>
          <p className="lede">
            Six intelligence sources give us the market. The properties we
            manage ourselves give us the truth about it. Where the two
            disagree, we say so.
          </p>
        </div>

        <div className="prov-grid">
          {PROVENANCE_PILLARS.map((p) => (
            <div key={p.id} className="prov-col">
              <span className="prov-col-eyebrow">{p.eyebrow}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>

        <div className="prov-sources">
          <div className="prov-source-group">
            <VerifiedTag tone="partner" label="Licensed & public" />
            <div className="prov-source-names">
              {EXTERNAL_SOURCES.map((s) => (
                <span key={s.id}>{s.name}</span>
              ))}
            </div>
          </div>
          <div className="prov-source-group">
            <VerifiedTag tone="operated" label="Our own bookings" />
            <div className="prov-source-names">
              {FIRST_PARTY_SOURCES.map((s) => (
                <span key={s.id}>{s.name}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
