import { DATA_SOURCES } from "@/lib/provenance-data";
import { VerifiedTag } from "./VerifiedTag";

// The /methodology page's reason to exist: every source named, what it can
// tell us, and — the part nobody else publishes — what it cannot.
// A native-v3 rebuild of the in-app AccuracyPanel idea; that component is
// built on lucide and shadcn tokens and reads as a foreign object here.

export function SourceLedger() {
  return (
    <section className="section-tight" id="sources">
      <div className="wrap-narrow">
        <div className="acc-head">
          <div className="eyebrow">Every source, named</div>
          <h2>What each one can tell us.</h2>
          <p className="lede">
            Two of these we generate ourselves by operating properties. The
            rest we license or take from public registers. Each entry says
            what it contributes and where it runs out — a source with no
            stated limit is a source nobody has examined.
          </p>
        </div>
        <div className="srcl-list">
          {DATA_SOURCES.map((s) => (
            <div key={s.id} className="srcl-row">
              <div className="srcl-name">
                <strong>{s.name}</strong>
                <VerifiedTag
                  tone={s.kind === "first-party" ? "operated" : "partner"}
                  label={s.kind === "first-party" ? "Ours" : s.kind}
                />
                <span className="srcl-produces">{s.produces}</span>
              </div>
              <p className="srcl-detail">{s.detail}</p>
              <div className="srcl-conf">
                <span className="srcl-conf-num">{s.confidence} / 100</span>
                <div className="srcl-conf-bar">
                  <div
                    className="srcl-conf-fill"
                    style={{ width: `${s.confidence}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
