import { C } from "../../_lib/brand";

// Decorative chapter number + title + subtitle. Number reduces 64→48px on
// narrow screens via the .sr-chapter-num class defined in styles.css.
export function ChapterHeader({
  number,
  title,
  subtitle,
}: {
  number: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="sr-chapter-num" style={{ fontWeight: 500, color: C.gray300, lineHeight: 1 }}>
        {number}
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 500, color: C.gray900, margin: "6px 0 0" }}>{title}</h2>
      <p style={{ fontSize: 15, fontWeight: 400, color: C.gray500, lineHeight: 1.5, margin: "8px 0 0" }}>
        {subtitle}
      </p>
    </div>
  );
}
