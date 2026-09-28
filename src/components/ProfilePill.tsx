import Link from "next/link";
import { GOALS_EDITOR_HREF } from "@/lib/nav";
import { pillLabel } from "@/lib/profile/state";
import { switchProfileAction } from "@/app/profiles/actions";

export interface PillProfiles {
  /** The active profile's name; null while the member has only one (the pill then just says "Profile"). */
  activeName: string | null;
  items: { id: string; name: string; active: boolean; paused: boolean }[];
  /** Where a switch returns to: the page the member is on. */
  returnTo: string;
}

/**
 * The Profile pill in the app nav (Batch 12), just before the usage chip.
 * While the profile is incomplete it carries a small ring and the
 * percentage ("Profile 60%"); once complete it just says "Profile".
 *
 * Saved profiles (Batch 13): it shows the active profile's name once the
 * member has two, and tapping it opens the switcher: every profile (switch
 * with one tap, back to the same page), edit this one, new, manage. It is
 * a <details> menu, so it works before any script has loaded. A team member
 * has no profile of their own here, so AppShell passes nothing and the pill
 * is not drawn.
 */
export function ProfilePill({ profile, saved = null }: { profile: { percent: number; complete: boolean } | null; saved?: PillProfiles | null }) {
  if (!profile) return null;
  const style: React.CSSProperties = { background: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 999, padding: "2px 10px", fontWeight: 600, textDecoration: "none", fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", maxWidth: 180 };
  const label = saved?.activeName ?? pillLabel(profile);
  const title = profile.complete ? "Your profile: every answer, and where to change it" : `Your profile is ${profile.percent}% done`;
  const face = (
    <>
      {!profile.complete && <Ring pct={profile.percent} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </>
  );
  if (!saved) {
    return (
      <Link href={GOALS_EDITOR_HREF} title={title} aria-label={profile.complete ? "Your profile" : `Your profile, ${profile.percent}% done`} style={style}>
        {face}
      </Link>
    );
  }
  const item: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "#1f2a1d", background: "transparent", border: 0, textDecoration: "none", cursor: "pointer" };
  return (
    <details style={{ position: "relative" }}>
      <summary title={title} aria-label={`Profile: ${label}. Switch, edit or add a profile`} style={{ ...style, listStyle: "none" }}>
        {face}
        <span aria-hidden="true" style={{ fontSize: 9, opacity: 0.8 }}>▾</span>
      </summary>
      <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, minWidth: 220, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", padding: "6px 0", overflow: "hidden" }}>
        {saved.items.length > 1 && (
          <>
            <p style={{ margin: 0, padding: "4px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "#6b7280" }}>Switch profile</p>
            {saved.items.map((p) =>
              p.active ? (
                <p key={p.id} style={{ ...item, margin: 0, fontWeight: 700, cursor: "default" }} aria-current="true">
                  ✓ {p.name}
                  {p.paused ? " (paused)" : ""}
                </p>
              ) : (
                <form key={p.id} action={switchProfileAction} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="next" value={saved.returnTo} />
                  <button type="submit" role="menuitem" style={item}>
                    {p.name}
                    {p.paused ? " (paused)" : ""}
                  </button>
                </form>
              ),
            )}
            <hr style={{ margin: "6px 0", border: 0, borderTop: "1px solid #e5e7eb" }} />
          </>
        )}
        <Link href={GOALS_EDITOR_HREF} role="menuitem" style={item}>
          Edit {saved.items.length > 1 ? "this profile" : "your profile"}
        </Link>
        <Link href="/profiles#new-profile" role="menuitem" style={item}>
          New profile
        </Link>
        <Link href="/profiles" role="menuitem" style={item}>
          Manage profiles
        </Link>
      </div>
    </details>
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
