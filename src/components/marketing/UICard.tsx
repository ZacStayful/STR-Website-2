import type { CSSProperties } from "react";

type Variant =
  | "peak-estimate-loading"
  | "comparable-listings"
  | "seasonality-mini"
  | "profit-calc-mini";

// The floating UI card overlay used over hero photography.
// Shows the software *doing the work* without revealing specific income figures
// for any user property. All numbers shown are properties of nearby comparable
// listings (facts about the listings) — not predictions about the user.
export function UICard({
  variant,
  style,
  className,
}: {
  variant: Variant;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`sf-uicard sf-uicard--${variant} ${className ?? ""}`} style={style}>
      <div className="sf-uicard__chrome">
        <span className="sf-uicard__dot" />
        <span className="sf-uicard__brand">Stayful · live</span>
        <span className="sf-uicard__pulse" aria-hidden />
      </div>
      <div className="sf-uicard__body">{renderBody(variant)}</div>
    </div>
  );
}

function renderBody(variant: Variant) {
  if (variant === "peak-estimate-loading") {
    return (
      <>
        <p className="sf-uicard__addr">1 Albion Street, Manchester M1</p>
        <ul className="sf-uicard__rows">
          <li>
            <span>Comparables found</span>
            <strong>8 within 0.5 mi</strong>
          </li>
          <li>
            <span>ADR range (nearby)</span>
            <strong>£155&ndash;£195</strong>
          </li>
          <li>
            <span>Seasonal peak</span>
            <strong>July</strong>
          </li>
        </ul>
        <div className="sf-uicard__progress" aria-hidden>
          <span />
        </div>
        <p className="sf-uicard__caption">Calculating peak income estimate&hellip;</p>
      </>
    );
  }
  if (variant === "comparable-listings") {
    const comps: Array<[string, string, string, string]> = [
      ["City Centre Penthouse", "0.3 mi", "£165", "65%"],
      ["Northern Quarter Loft", "0.5 mi", "£155", "63%"],
      ["Ancoats Modern Flat", "0.4 mi", "£142", "68%"],
      ["Piccadilly Village Apt", "0.2 mi", "£170", "62%"],
    ];
    return (
      <>
        <p className="sf-uicard__addr">8 listings within 0.5 mi</p>
        <ul className="sf-uicard__list">
          {comps.map(([name, dist, adr, occ]) => (
            <li key={name}>
              <span className="sf-uicard__listname">{name}</span>
              <span className="sf-uicard__listmeta">
                {dist} · {adr} · {occ}
              </span>
            </li>
          ))}
        </ul>
        <p className="sf-uicard__caption">+ 4 more · de-select to refine your estimate</p>
      </>
    );
  }
  if (variant === "seasonality-mini") {
    const heights = [42, 38, 50, 58, 54, 78, 64, 60, 70, 62, 64, 38];
    const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    return (
      <>
        <p className="sf-uicard__addr">Twelve-month view</p>
        <div className="sf-uicard__bars" aria-hidden>
          {heights.map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} className={i === 5 ? "is-peak" : ""} />
          ))}
        </div>
        <div className="sf-uicard__monthrow">
          {months.map((m, i) => (
            <span key={i} className={i === 5 ? "is-peak" : ""}>{m}</span>
          ))}
        </div>
        <p className="sf-uicard__caption">Peak: June &middot; trough: December</p>
      </>
    );
  }
  // profit-calc-mini
  return (
    <>
      <p className="sf-uicard__addr">Net monthly profit</p>
      <ul className="sf-uicard__rows">
        <li>
          <span>Mortgage</span>
          <strong>&minus; entered</strong>
        </li>
        <li>
          <span>Cleaning &amp; bills</span>
          <strong>&minus; modelled</strong>
        </li>
        <li>
          <span>Management (optional)</span>
          <strong>&minus; 0&ndash;15%</strong>
        </li>
      </ul>
      <p className="sf-uicard__caption">Adjust assumptions &middot; rerun in one click</p>
    </>
  );
}
