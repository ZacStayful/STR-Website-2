import Link from "next/link";
import { UsageChip } from "@/components/credit/UsageChip";
import { FeedbackTrigger } from "@/components/feedback/FeedbackTrigger";
import { ProfilePill, type PillProfiles } from "@/components/ProfilePill";
import { HeaderEyeLink } from "@/components/intelligence/HeaderEyeLink";
import type { EyeLevel } from "@/components/StayfulEye";
import type { ChatUi } from "@/lib/chat/reply";
import { NAV_TARGETS, NAV_ORDER, LEADS_NAV, activeNavFor, type Section, type ActiveNav } from "@/lib/nav";

// Thin strip shown to signed-in members, in the order Zac decided (Batch
// 22e; see src/lib/nav.ts): the eye ("Talk to Stayful Intelligence"), Home,
// Today, My deals, Browse, Market Explorer, Analyser and Account — plus
// Leads for anyone whose team owns a
// funnel (existing funnel customers keep their door), the admin dashboard for
// admins, and the usage chip (Batch 10), which reads the balance from the
// surrounding CreditProvider (see AppShell). A team member's team is on their
// Account page (Batch 11), so it has no header item of its own.
//
// Where each item points is decided in src/lib/nav.ts, one line per item. A
// page with no item of its own (daily picks, the profile page) still
// announces the section it always did, and NAV_FOR_SECTION says which item
// that lights up.
//
// The Stayful Intelligence eye (Batch 22) comes first, then the nav items;
// the pill, the usage chip, the admin's Dashboard chip and Feedback sit in
// one group after them, so on a phone the group wraps onto its own row
// rather than splitting the nav items. At 375px the strip wraps to three
// rows (eye to Browse, Market Explorer to Account, then the chips): every
// item stays visible, nothing goes into a menu (Batch 22e, decided).
export function AppSwitcher({ active, admin, leads, profile = null, saved = null, eyeLevel = null, chat = null }: { active: Section; admin?: boolean; leads?: boolean; profile?: { percent: number; complete: boolean } | null; saved?: PillProfiles | null; eyeLevel?: EyeLevel | null; chat?: ChatUi | null }) {
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
  // The chip style the usage chip and Feedback use, for the admin's Dashboard link.
  const chipStyle: React.CSSProperties = { background: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 999, padding: "2px 10px", fontWeight: 600, textDecoration: "none", fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 };

  return (
    <nav
      aria-label="Stayful apps"
      style={{
        display: "flex",
        gap: 12,
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
      {/* Batch 22: the Stayful Intelligence eye leads the row; Batch 22e gives it its words. */}
      {eyeLevel !== null && <HeaderEyeLink level={eyeLevel} style={linkStyle(false)} chat={chat} />}
      {NAV_ORDER.filter((key) => key !== "account").map((key) => item(key, NAV_TARGETS[key].href, NAV_TARGETS[key].label))}
      {leads && item("leads", LEADS_NAV.href, LEADS_NAV.label)}
      {item("account", NAV_TARGETS.account.href, NAV_TARGETS.account.label)}
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
        <ProfilePill profile={profile} saved={saved} />
        {admin && (
          <Link href="/admin" style={chipStyle} title="The admin dashboard">
            Dashboard
          </Link>
        )}
        <UsageChip />
        {/* Batch 18: a shortcut to the feedback form, not a nav item. */}
        <FeedbackTrigger variant="header" />
      </span>
    </nav>
  );
}
