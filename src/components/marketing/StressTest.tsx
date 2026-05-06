// Stress-test view — three scenario cards (Base / -10% / -20%) showing
// the software's worst-case stress test for any UK property.
// Lead-intel insight: every conversion converged on a worst-month figure
// that still beat the user's long-let — the *floor*, not the peak.
// Pure HTML/CSS mockup; no specific income figures.

const HEIGHTS = {
  base: [0.42, 0.38, 0.5, 0.58, 0.62, 0.84, 0.92, 0.86, 0.74, 0.6, 0.5, 0.34],
  ten: [0.38, 0.34, 0.45, 0.52, 0.56, 0.76, 0.83, 0.78, 0.67, 0.54, 0.45, 0.31],
  twenty: [0.34, 0.30, 0.40, 0.46, 0.50, 0.67, 0.74, 0.69, 0.59, 0.48, 0.40, 0.27],
};
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

type Scenario = {
  key: keyof typeof HEIGHTS;
  label: string;
  sublabel: string;
  emphasis: "base" | "moderate" | "worst";
};

const SCENARIOS: Scenario[] = [
  { key: "base", label: "Base case", sublabel: "Modelled occupancy + ADR", emphasis: "base" },
  { key: "ten", label: "−10% scenario", sublabel: "If every month underperforms", emphasis: "moderate" },
  { key: "twenty", label: "−20% worst case", sublabel: "Every assumption wrong", emphasis: "worst" },
];

export function StressTest() {
  return (
    <div className="sf-stress">
      {SCENARIOS.map((scenario) => (
        <div key={scenario.key} className={`sf-stress__card sf-stress__card--${scenario.emphasis}`}>
          <div className="sf-stress__head">
            <span className="sf-stress__label">{scenario.label}</span>
            <span className="sf-stress__sublabel">{scenario.sublabel}</span>
          </div>
          <div className="sf-stress__bars" aria-hidden>
            {HEIGHTS[scenario.key].map((h, i) => {
              const isPeak = i === 6;
              return (
                <span key={i} style={{ height: `${h * 100}%` }} className={isPeak ? "is-peak" : ""} />
              );
            })}
          </div>
          <div className="sf-stress__monthrow" aria-hidden>
            {MONTHS.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          <div className="sf-stress__verdict">
            <span className="sf-stress__check" aria-hidden>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path
                  d="M3.5 8.5l3 3 6-6.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>Every month above your long-let</span>
          </div>
        </div>
      ))}
    </div>
  );
}
