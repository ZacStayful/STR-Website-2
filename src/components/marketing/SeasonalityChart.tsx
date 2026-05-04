// A4 — 12-month seasonality visualisation.
// Pure SVG. Bars show the *shape* of a UK short-term let year, not specific
// numbers — the headline is "your year isn't annual ÷ 12", not a figure.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Illustrative monthly intensity for a typical UK STR — peak around July,
// trough around December. Values are 0–1 only.
const HEIGHTS = [0.42, 0.38, 0.5, 0.58, 0.62, 0.84, 0.92, 0.86, 0.74, 0.6, 0.5, 0.34];

export function SeasonalityChart({ caption }: { caption?: string }) {
  const w = 880;
  const h = 280;
  const pad = { l: 28, r: 28, t: 24, b: 40 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const slot = innerW / MONTHS.length;
  const barW = slot * 0.62;
  const peakIndex = HEIGHTS.indexOf(Math.max(...HEIGHTS));

  return (
    <div className="sf-season">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Twelve-month UK short-term let seasonality">
        <defs>
          <linearGradient id="sf-season-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5d8156" />
            <stop offset="100%" stopColor="#a8c9b8" />
          </linearGradient>
          <linearGradient id="sf-season-bar-peak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a6944" />
            <stop offset="100%" stopColor="#5d8156" />
          </linearGradient>
        </defs>

        {/* baseline */}
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={h - pad.b}
          y2={h - pad.b}
          stroke="rgba(93,129,86,0.18)"
          strokeWidth={1}
        />

        {HEIGHTS.map((v, i) => {
          const barH = v * innerH;
          const x = pad.l + i * slot + (slot - barW) / 2;
          const y = h - pad.b - barH;
          const isPeak = i === peakIndex;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={6}
                ry={6}
                fill={`url(#${isPeak ? "sf-season-bar-peak" : "sf-season-bar"})`}
              />
              {isPeak ? (
                <>
                  <circle cx={x + barW / 2} cy={y - 10} r={5} fill="#5d8156" />
                  <text
                    x={x + barW / 2}
                    y={y - 18}
                    fontSize="13"
                    fontWeight="700"
                    fill="#4a6944"
                    textAnchor="middle"
                    fontFamily="system-ui, sans-serif"
                  >
                    Peak
                  </text>
                </>
              ) : null}
              <text
                x={x + barW / 2}
                y={h - pad.b + 22}
                fontSize="12"
                fontWeight="600"
                fill="#5d8156"
                textAnchor="middle"
                fontFamily="system-ui, sans-serif"
                opacity={isPeak ? 1 : 0.7}
              >
                {MONTHS[i]}
              </text>
            </g>
          );
        })}
      </svg>
      {caption ? <p className="sf-season__caption">{caption}</p> : null}
    </div>
  );
}
