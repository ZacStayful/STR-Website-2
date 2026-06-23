import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./styles.css";

// DM Sans, weights 400 + 500 only, per the Stayful design system.
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "STR Intelligence Report | Stayful",
  description:
    "Find out if your property is worth short letting. Personalised income analysis, market data, and a clear verdict — in under 60 seconds.",
  robots: { index: false, follow: false },
};

export default function StrReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={dmSans.variable}
      style={{
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
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
