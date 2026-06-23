import { C, gbp, ratingColors } from "../../_lib/brand";
import type { MarketData, PropertyInput } from "../../_lib/types";
import { competitiveness } from "../../_lib/location";
import { ChapterHeader } from "../ui/ChapterHeader";
import { StatTile } from "../ui/StatTile";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tileColors(occ: number): { bg: string; tx: string } {
  if (occ >= 83) return { bg: "#3a5537", tx: C.white };
  if (occ >= 73) return { bg: "#5d8156", tx: C.white };
  if (occ >= 66) return { bg: "#8fad8a", tx: "#3a5537" };
  if (occ >= 58) return { bg: "#b8ccb5", tx: "#3a5537" };
  return { bg: "#dce8db", tx: "#3a5537" };
}

const cardStyle: React.CSSProperties = {
  border: `1px solid ${C.gray200}`,
  borderRadius: 12,
  padding: "1rem 1.25rem",
  marginTop: 16,
};

export function MarketChapter({ input, market }: { input: PropertyInput; market: MarketData }) {
  const comp = competitiveness(market);
  const compColors = ratingColors(comp.rating);
  return (
    <div className="sr-chapter-enter">
      <ChapterHeader
        number="01"
        title="Your local market"
        subtitle={`Here's what the short-let market looks like near ${input.postcode} right now.`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <StatTile
          label="Active STR listings nearby"
          value={market.listingCount.toLocaleString()}
          sub="within 2 miles"
          valueColor={C.green}
        />
        <StatTile label={`Avg daily rate (${input.beds}-bed)`} value={gbp(market.avgDailyRate)} sub="across the market" />
        <StatTile label="Average occupancy" value={`${market.avgOccupancy}%`} sub="past 12 months" />
        <StatTile label="Median gross / month" value={gbp(market.medianGrossMonthly)} sub={`${input.beds}-beds in area`} />
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 10 }}>
          Demand through the year
        </div>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {market.monthlyOccupancy.map((occ, i) => {
            const col = tileColors(occ);
            return (
              <div
                key={MONTHS[i]}
                style={{
                  flex: "1 1 0",
                  minWidth: 24,
                  background: col.bg,
                  color: col.tx,
                  borderRadius: 4,
                  padding: "6px 2px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 500 }}>{MONTHS[i]}</div>
                <div style={{ fontSize: 10, fontWeight: 500, marginTop: 2 }}>{occ}%</div>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: C.gray400, fontStyle: "italic", margin: "10px 0 0" }}>
          Estimated occupancy by month — comparable {input.beds}-bed properties
        </p>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 10 }}>
          What drives demand near {input.postcode}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {market.demandDrivers.map((d) => (
            <span
              key={d.label}
              style={{
                background: C.greenLt,
                color: C.greenTx,
                fontSize: 12,
                fontWeight: 500,
                padding: "5px 10px",
                borderRadius: 999,
              }}
            >
              {d.label} · {d.percentage}%
            </span>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>How competitive the area is</span>
          <span
            style={{
              background: compColors.bg,
              color: compColors.tx,
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            {comp.rating === "Low" ? "Low competition" : comp.rating === "Moderate" ? "Moderate" : "High competition"}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${comp.score}%`, background: compColors.fill }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.gray400, marginTop: 4 }}>
          <span>Room to stand out</span>
          <span>Saturated</span>
        </div>
        <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.7, margin: "10px 0 0" }}>{comp.summary}</p>
      </div>
    </div>
  );
}
