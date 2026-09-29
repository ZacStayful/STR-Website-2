import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { GOALS_EDITOR_HREF } from "@/lib/nav";
import { dealTypesFor, describeTypes } from "@/lib/profile/deal-types";
import { profilePriceLineFor, profilesFor } from "@/lib/profiles/server";
import { CLIENT_PERMISSION_LINE, isRunning, limitMessage, NAME_HINT, PROFILE_NAME_MAX, TYPE_CHOICES } from "@/lib/profiles/rules";
import { createProfileAction, deleteProfileAction, editProfileAction, pauseProfileAction, renameProfileAction, switchProfileAction } from "./actions";

export const metadata: Metadata = {
  title: "Your profiles — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  renamed: "Profile renamed.",
  paused: "Daily deals paused for that profile. Nothing is charged for it until you resume.",
  resumed: "Daily deals resumed. They start again with the next morning’s email.",
  deleted: "Profile deleted. Its deals stay in My deals.",
  created: "Profile created.",
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Saved profiles (Batch 13): up to five, one per kind of property the member
 * is hunting for (a deal sourcer keeps one per client). The active one is
 * what the header, Today, the deal pages and the Explorer follow; every
 * running one gets its own Today's 5 in the daily email, charged daily.
 * A profile pauses only when the member pauses it here.
 */
export default async function ProfilesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/profiles");

  const view = await profilesFor(user.id);
  const msg = first(params.msg);
  const error = first(params.error);
  if (!view.readable) {
    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <h1 className="text-2xl font-bold text-foreground">Your profiles</h1>
          <p className="mt-2 text-sm text-muted-foreground">Saved profiles aren’t available yet. Please try again shortly.</p>
        </div>
      </main>
    );
  }
  const priceLine = await profilePriceLineFor(user.id, isAdminEmail(user.email));
  const atLimit = view.live.length >= view.max;
  const canCreate = !view.teamMember && !atLimit;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Your profiles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep a profile for each kind of property you’re looking for, or one per client. The one you’re on is what Today, your deals and the numbers follow. Each profile that isn’t paused gets its own Today’s 5 every morning.
          </p>
          {priceLine && <p className="mt-2 text-sm font-medium text-foreground">{priceLine}.</p>}
        </header>

        {msg === "error" && error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">{error}</p>
        ) : msg && MESSAGES[msg] ? (
          <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">{MESSAGES[msg]}</p>
        ) : null}

        <ul className="space-y-3">
          {view.live.map((p) => {
            const running = isRunning(p);
            const types = dealTypesFor({ goals: p.goals, about: null });
            return (
              <li key={p.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">{p.name}</h2>
                  {p.isActive && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">You’re on this one</span>}
                  {!running && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Paused</span>}
                  {p.forClient && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">For a client</span>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {types.length > 0 ? describeTypes(types) : "No answers yet"}
                  {" · "}
                  {running ? "Daily deals on" : "Daily deals paused: nothing is charged for this profile"}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {p.isActive ? (
                    <Link href={GOALS_EDITOR_HREF} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                      Edit answers
                    </Link>
                  ) : (
                    <>
                      <form action={switchProfileAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="next" value="/today" />
                        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Switch to this one</button>
                      </form>
                      <form action={editProfileAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">Edit answers</button>
                      </form>
                    </>
                  )}
                  <form action={pauseProfileAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="paused" value={running ? "1" : "0"} />
                    <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">{running ? "Pause daily deals" : "Resume daily deals"}</button>
                  </form>
                </div>

                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Rename{p.isActive ? "" : " or delete"}</summary>
                  <form action={renameProfileAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Name</span>
                      <input name="name" defaultValue={p.name} maxLength={PROFILE_NAME_MAX} required className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                    </label>
                    <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">Save name</button>
                  </form>
                  {p.isActive ? (
                    <p className="mt-2 text-xs text-muted-foreground">To delete this profile, switch to another one first.</p>
                  ) : (
                    <form action={deleteProfileAction} className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" name="confirm" value="1" required /> Delete “{p.name}”. Its daily deals stop; the deals you kept under it stay in My deals.
                      </label>
                      <button type="submit" className="rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10">Delete</button>
                    </form>
                  )}
                </details>
              </li>
            );
          })}
        </ul>

        {!view.teamMember && (
          <section aria-labelledby="new-profile" className="rounded-xl border border-border bg-card p-4">
            <h2 id="new-profile" className="text-base font-semibold text-foreground">New profile</h2>
            {atLimit ? (
              <p className="mt-2 text-sm text-foreground">{limitMessage(view.max)}</p>
            ) : (
              <form action={createProfileAction} className="mt-3 space-y-3">
                <p className="text-sm text-muted-foreground">It starts as a copy of one you have, so you only change what’s different.</p>
                {priceLine && <p className="text-sm font-medium text-foreground">{priceLine}.</p>}
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-foreground">Name</span>
                  <input name="name" required maxLength={PROFILE_NAME_MAX} placeholder="Manchester R2R, Client: JS…" className="rounded-md border border-border bg-background px-2 py-1.5" />
                  <span className="text-xs text-muted-foreground">{NAME_HINT}</span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-foreground">Copy from</span>
                  <select name="copy_from" defaultValue={view.active?.id ?? ""} className="rounded-md border border-border bg-background px-2 py-1.5">
                    {view.live.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <fieldset className="text-sm">
                  <legend className="font-medium text-foreground">Which deals should this profile show?</legend>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {TYPE_CHOICES.map((c) =>
                      c.soon ? (
                        // Declared but not available yet: shown, never chosen (Batch 17, Part 4).
                        <label key={c.value} className="flex items-center gap-1.5 text-muted-foreground opacity-60" aria-disabled="true">
                          <input type="checkbox" disabled /> {c.label} <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">Coming soon</span>
                        </label>
                      ) : (
                        <label key={c.value} className="flex items-center gap-1.5">
                          <input type="checkbox" name="types" value={c.value} defaultChecked={dealTypesFor({ goals: view.active?.goals ?? null, about: null }).includes(c.value)} /> {c.label}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="for_client" value="1" className="mt-1" />
                  <span>
                    <span className="font-medium text-foreground">This profile is for a client</span>
                    <span className="block text-xs text-muted-foreground">
                      {CLIENT_PERMISSION_LINE} <Link href="/privacy#other-people" className="underline-offset-4 hover:underline">How we use it</Link>
                    </span>
                  </span>
                </label>
                <button type="submit" disabled={!canCreate} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  Create and switch to it
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
