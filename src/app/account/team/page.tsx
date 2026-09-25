import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { teamOf, teamName, profileNames, personName } from "@/lib/team";
import { retentionDate } from "@/lib/leads/retention";
import { InviteForm, RevokeInviteButton, RemoveMemberForm, LeaveTeamForm } from "./TeamForms";

export const metadata: Metadata = {
  title: "Team — Stayful Intelligence",
  robots: { index: false, follow: false },
};

interface MemberRow {
  member_id: string;
  joined_at: string;
  seat_paid_until: string;
  suspended_at: string | null;
  created_via_invite: boolean;
}

interface InviteRow {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
}

/**
 * The team: who is on it, who has been invited, and what each seat costs.
 * The owner manages it here; a member sees whose team they are on and can
 * leave.
 */
export default async function TeamPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/team");
  const team = await teamOf(user.id);
  const name = await teamName(team.ownerId);

  if (team.role === "member") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-foreground">Team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;re a member of <span className="font-medium text-foreground">{name}</span>. The account owner manages
          funnels, integrations and billing.
        </p>
        {team.suspended ? (
          <p className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            Your seat is paused because the team&apos;s balance is too low. It comes back automatically when the owner tops up.
          </p>
        ) : null}
        <p className="mt-4 text-sm text-muted-foreground">
          Your own emails — daily picks, weekly area alerts, credit warnings — are yours to switch in <Link href="/account/notifications" className="underline">Notifications</Link>.
        </p>
        <section className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Leave the team</h2>
          <LeaveTeamForm />
        </section>
      </main>
    );
  }

  let members: MemberRow[] = [];
  let invites: InviteRow[] = [];
  if (hasServiceRole()) {
    const admin = createAdminClient();
    const [m, i] = await Promise.all([
      admin.from("team_members").select("member_id, joined_at, seat_paid_until, suspended_at, created_via_invite").eq("owner_id", user.id).order("joined_at"),
      admin
        .from("team_invites")
        .select("id, email, created_at, expires_at")
        .eq("owner_id", user.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
    ]);
    members = (m.data ?? []) as MemberRow[];
    invites = (i.data ?? []) as InviteRow[];
  }
  const names = await profileNames(members.map((m) => m.member_id));
  const anySuspended = members.some((m) => m.suspended_at);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground">Team</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Invite colleagues to work your leads in <span className="font-medium text-foreground">{name}</span>. Each member
        costs <span className="font-medium text-foreground">£10 a month</span> from your credit, taken when they accept and
        every 30 days after. Funnels, integrations, API keys and billing stay yours to manage.
      </p>

      {anySuspended ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <span>Some seats are paused because your balance didn&apos;t cover the renewal. Top up and they come back automatically.</span>
          <Link href="/account/billing" className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">Top up</Link>
        </div>
      ) : null}

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Invite someone</h2>
        <InviteForm />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Members ({members.length})</h2>
        {members.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No one yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {members.map((m) => {
              const p = names.get(m.member_id);
              return (
                <li key={m.member_id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{personName(p)}</p>
                    {p?.full_name && p.email ? <p className="text-xs text-muted-foreground">{p.email}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Joined {retentionDate(m.joined_at)} ·{" "}
                      {m.suspended_at
                        ? <span className="text-warning">Paused since {retentionDate(m.suspended_at)}</span>
                        : <>Next £10 on {retentionDate(m.seat_paid_until)}</>}
                    </p>
                  </div>
                  <RemoveMemberForm memberId={m.member_id} name={personName(p)} deletesLogin={m.created_via_invite} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {invites.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Invited</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-foreground">{i.email}</p>
                  <p className="text-xs text-muted-foreground">Link works until {retentionDate(i.expires_at)}</p>
                </div>
                <RevokeInviteButton inviteId={i.id} email={i.email} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
