import { C } from "../../_lib/brand";

export function StatTile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div style={{ background: C.gray50, borderRadius: 8, padding: "0.9rem" }}>
      <div style={{ fontSize: 11, color: C.gray500, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: valueColor ?? C.gray900, marginTop: 4 }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
