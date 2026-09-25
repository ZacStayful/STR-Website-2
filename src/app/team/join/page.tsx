import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { joinCheck, inviteByToken } from "@/lib/team/invites";
import { JOIN_BLOCKER_COPY } from "@/lib/team/rules";
import { teamName } from "@/lib/team";
import { AcceptForm } from "./AcceptForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join your team — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Where an invite link lands. Public, because the person may not have a
 * login yet: signed out, they are sent to sign up or log in and brought back
 * here; signed in, they see either the Join button or exactly why they
 * cannot join with this account.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  const here = `/team/join?token=${encodeURIComponent(token)}`;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const invite = await inviteByToken(token);
  const name = invite ? await teamName(invite.owner_id) : null;

  let body: React.ReactNode;
  if (!invite) {
    body = <p className="mt-3 text-sm text-muted-foreground">{JOIN_BLOCKER_COPY.invalid}</p>;
  } else if (!user) {
    body = (
      <>
        <p className="mt-3 text-sm text-muted-foreground">
          You&apos;ve been invited to join <span className="font-medium text-foreground">{name}</span> on Stayful. Use{" "}
          <span className="font-medium text-foreground">{invite.email}</span> to sign up or log in, and you&apos;ll come
          straight back here.
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link href={`/signup?next=${encodeURIComponent(here)}`} className="rounded-md bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground hover:opacity-90">
            Create my login
          </Link>
          <Link href={`/login?redirect=${encodeURIComponent(here)}`} className="rounded-md border border-border px-4 py-2.5 text-center text-sm font-medium hover:bg-muted">
            I already have one
          </Link>
        </div>
      </>
    );
  } else {
    const { blocker } = await joinCheck({ id: user.id, email: user.email ?? null }, token);
    body = blocker ? (
      <p className="mt-3 text-sm text-muted-foreground">{JOIN_BLOCKER_COPY[blocker]}</p>
    ) : (
      <>
        <p className="mt-3 text-sm text-muted-foreground">
          Join <span className="font-medium text-foreground">{name}</span> as{" "}
          <span className="font-medium text-foreground">{user.email}</span>. You&apos;ll be able to search and work the
          team&apos;s leads. The account owner pays for your seat.
        </p>
        <AcceptForm token={token} />
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">{name ? `Join ${name}` : "Team invite"}</h1>
        {body}
      </div>
    </main>
  );
}
