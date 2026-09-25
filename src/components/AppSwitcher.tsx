import Link from "next/link";
import { CreditBadge } from "@/components/credit/CreditBadge";

// Thin strip shown to signed-in users so they can move between the members-only
// surfaces (the analyser, the Market Explorer, saved reports, inbound leads,
// the account page and billing).
//
// "My reports" and "Leads" are deliberately separate entries: one is the
// properties a member chose to research, the other is strangers who filled in
// their funnel. They are different products and never share a list.
// Admins also get the admin dashboard link. The credit badge reads the
// balance from the surrounding CreditProvider (see AppShell).
// A team member's reports are the team's ("Team reports"), and billing is the
// owner's, so members get Team in its place.
export function AppSwitcher({ active, admin, teamMember }: { active: "estimate" | "markets" | "deals" | "picks" | "reports" | "leads" | "account"; admin?: boolean; teamMember?: boolean }) {
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
      <Link href="/deals" style={linkStyle(active === "deals")} aria-current={active === "deals" ? "page" : undefined}>
        Deals
      </Link>
      <Link href="/picks" style={linkStyle(active === "picks")} aria-current={active === "picks" ? "page" : undefined}>
        Daily picks
      </Link>
      <Link href="/reports" style={linkStyle(active === "reports")} aria-current={active === "reports" ? "page" : undefined}>
        {teamMember ? "Team reports" : "My reports"}
      </Link>
      <Link href="/leads" style={linkStyle(active === "leads")} aria-current={active === "leads" ? "page" : undefined}>
        Leads
      </Link>
      <Link href="/account" style={linkStyle(active === "account")} aria-current={active === "account" ? "page" : undefined}>
        Account
      </Link>
      {teamMember ? (
        <Link href="/account/team" style={linkStyle(false)}>
          Team
        </Link>
      ) : (
        <Link href="/account/billing" style={linkStyle(false)}>
          Billing
        </Link>
      )}
      {admin && (
        <Link href="/admin" style={linkStyle(false)}>
          Dashboard
        </Link>
      )}
      <CreditBadge />
    </nav>
  );
}
