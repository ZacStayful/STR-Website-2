import type { Metadata } from "next";
import { dmSansVariable } from "@/lib/fonts";
import "./styles.css";

export const metadata: Metadata = {
  title: "STR Intelligence Report | Stayful",
  description:
    "Find out if your property is worth short letting. Personalised income analysis, market data, and a clear verdict — in under 60 seconds.",
  robots: { index: false, follow: false },
};

export default function StrReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={dmSansVariable}
      style={{
        fontFamily: "var(--font-dmsans), system-ui, sans-serif",
        background: "#ffffff",
        color: "#111827",
        minHeight: "100vh",
        fontSize: 14,
        lineHeight: 1.7,
      }}
    >
      {children}
    </div>
  );
}
