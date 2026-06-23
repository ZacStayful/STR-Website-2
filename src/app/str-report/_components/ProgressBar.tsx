import { C } from "../_lib/brand";

const LABELS = ["Your market", "Location & demand", "Your income", "STR vs long let", "Risk profile", "The verdict"];

// Six visible chapters map to five labelled segments (Market…Verdict). Chapter
// state 2 = segment 0. Not shown for chapters 0 (input) or 1 (scanning).
export function ProgressBar({ chapter }: { chapter: number }) {
  if (chapter < 2) return null;
  const activeIndex = chapter - 2; // 0..4
  const label = LABELS[activeIndex] ?? "";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
      <div style={{ display: "flex", gap: 4, flex: 1 }}>
        {LABELS.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= activeIndex ? C.green : C.gray200,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
