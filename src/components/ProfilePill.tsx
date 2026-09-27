import Link from "next/link";
import { GOALS_EDITOR_HREF } from "@/lib/nav";
import { pillLabel } from "@/lib/profile/state";

/**
 * The Profile pill in the app nav (Batch 12), just before the usage chip: a
 * header shortcut to the profile page, not a nav item. While the profile is
 * incomplete it carries a small ring and the percentage ("Profile 60%");
 * once complete it just says "Profile". A team member has no profile to
 * finish here, so AppShell passes nothing and the pill is not drawn.
 */
export function ProfilePill({ profile }: { profile: { percent: number; complete: boolean } | null }) {
  if (!profile) return null;
  const style: React.CSSProperties = { background: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 999, padding: "2px 10px", fontWeight: 600, textDecoration: "none", fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 };
  const label = pillLabel(profile);
  return (
    <Link href={GOALS_EDITOR_HREF} title={profile.complete ? "Your profile: every answer, and where to change it" : `Your profile is ${profile.percent}% done`} aria-label={profile.complete ? "Your profile" : `Your profile, ${profile.percent}% done`} style={style}>
      {!profile.complete && <Ring pct={profile.percent} />}
      {label}
    </Link>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 5;
  const len = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2.5} />
      <circle cx="7" cy="7" r={r} fill="none" stroke="#B9D5C6" strokeWidth={2.5} strokeDasharray={`${(len * Math.max(0, Math.min(100, pct))) / 100} ${len}`} transform="rotate(-90 7 7)" strokeLinecap="round" />
    </svg>
  );
}
