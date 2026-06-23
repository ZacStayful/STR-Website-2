import { C } from "../../_lib/brand";

// Back (ghost) + Continue (green). Back only renders from chapter 3 onwards.
export function NavButtons({
  chapter,
  onBack,
  onContinue,
}: {
  chapter: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const showBack = chapter >= 3;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 24 }}>
      {showBack ? (
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "transparent",
            color: C.gray500,
            border: "none",
            fontSize: 14,
            fontWeight: 500,
            minHeight: 44,
            padding: "0 8px",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onContinue}
        style={{
          background: C.green,
          color: C.white,
          border: "none",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          minHeight: 44,
          padding: "0 20px",
          cursor: "pointer",
        }}
      >
        Continue →
      </button>
    </div>
  );
}
