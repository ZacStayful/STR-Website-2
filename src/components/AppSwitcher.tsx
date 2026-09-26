import Link from "next/link";
import { CreditBadge } from "@/components/credit/CreditBadge";
import { NAV_TARGETS, NAV_ORDER, LEADS_NAV, activeNavFor, type Section, type ActiveNav } from "@/lib/nav";

// Thin strip shown to signed-in members: Today, My deals and Account — the
// three places the app now lives — plus Leads for anyone whose team owns a
// funnel (existing funnel customers keep their door), Team for team members
// (billing is the owner's, and lives under Account for everyone else), the
// admin dashboard for admins, and the credit badge, which reads the balance
// from the surrounding CreditProvider (see AppShell).
//
// Where each item points is decided in src/lib/nav.ts, one line per item. A
// page that left the strip (the analyser, the Market Explorer, daily picks)
// still announces the section it always did, and NAV_FOR_SECTION says which
// item that lights up.
export function AppSwitcher({ active, admin, teamMember, leads }: { active: Section; admin?: boolean; teamMember?: boolean; leads?: boolean }) {
  const current = activeNavFor(active);
  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    color: isActive ? "#fff" : "#B9D5C6",
    fontWeight: 600,
    textDecoration: "none",
    borderBottom: isActive ? "2px solid #B9D5C6" : "2px solid transparent",
    paddingBottom: 2,
  });
  const item = (key: ActiveNav, href: string, label: string) => (
    <Link key={key} href={href} style={linkStyle(current === key)} aria-current={current === key ? "page" : undefined}>
      {label}
    </Link>
  );

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
      {NAV_ORDER.filter((key) => key !== "account").map((key) => item(key, NAV_TARGETS[key].href, NAV_TARGETS[key].label))}
      {leads && item("leads", LEADS_NAV.href, LEADS_NAV.label)}
      {item("account", NAV_TARGETS.account.href, NAV_TARGETS.account.label)}
      {teamMember && (
        <Link href="/account/team" style={linkStyle(false)}>
          Team
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
