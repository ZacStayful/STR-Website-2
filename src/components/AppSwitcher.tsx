import Link from "next/link";
import { CreditBadge } from "@/components/credit/CreditBadge";

// Thin strip shown to signed-in users so they can move between the members-only
// surfaces (the analyser, the Market Explorer, saved reports and billing).
// Admins also get the admin dashboard link. The credit badge reads the
// balance from the surrounding CreditProvider (see AppShell).
export function AppSwitcher({ active, admin }: { active: "estimate" | "markets" | "reports" | "account"; admin?: boolean }) {
  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    color: isActive ? "#fff" : "#B9D5C6",
    fontWeight: 600,
    textDecoration: "none",
    borderBottom: isActive ? "2px solid #B9D5C6" : "2px solid transparent",
    paddingBottom: 2,
  });

  return (
    <nav
      aria-label="Stayful apps"
      style={{
        display: "flex",
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "7px 12px",
        fontSize: 13,
        background: "#2E3D2B",
        color: "#fff",
        fontFamily: "var(--font-dmsans), var(--font-sans), system-ui, sans-serif",
      }}
    >
      {admin && <span style={{ opacity: 0.8 }}>Admin</span>}
      <Link href="/estimate" style={linkStyle(active === "estimate")} aria-current={active === "estimate" ? "page" : undefined}>
        Analyser
      </Link>
      <Link href="/markets" style={linkStyle(active === "markets")} aria-current={active === "markets" ? "page" : undefined}>
        Market Explorer
      </Link>
      <Link href="/reports" style={linkStyle(active === "reports")} aria-current={active === "reports" ? "page" : undefined}>
        My reports
      </Link>
      <Link href="/account/billing" style={linkStyle(active === "account")} aria-current={active === "account" ? "page" : undefined}>
        Billing
      </Link>
      {admin && (
        <Link href="/admin" style={linkStyle(false)}>
          Dashboard
        </Link>
      )}
      <CreditBadge />
    </nav>
  );
}
