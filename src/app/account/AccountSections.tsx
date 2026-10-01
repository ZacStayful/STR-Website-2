import Link from "next/link";
import { describeGoals, type MarketGoals } from "@/lib/market/goals";
import { formatGbp } from "@/lib/credit/pricing";
import { SEAT_PRICE_PENCE } from "@/lib/team/rules";
import { ACCOUNT_MORE, GOALS_EDITOR_HREF, type AccountMoreKey } from "@/lib/nav";
import { signOutAction } from "../(auth)/actions";
import { describeTypes } from "@/lib/profile/deal-types";

/**
 * The parts of Account after the plan and billing (Batch 11): notifications,
 * what the member is looking for, the quieter "More" doors and signing out.
 * Shared by an account owner's page and a team member's, which has no plan
 * or billing of its own. Server components: nothing here runs in the browser.
 */

const CARD = "mt-6 rounded-2xl border border-[#e4e7dc] bg-white p-5";
const CHIP = "rounded-full bg-[#f1f3ec] px-2.5 py-0.5 text-xs font-medium text-[#2e3d2b]";

export function AccountHeader({ name, email, memberSince }: { name: string | null; email: string | null | undefined; memberSince: string | null }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Your account</p>
      <h1 className="mt-1 text-2xl font-bold">{name ?? "Account"}</h1>
      <p className="mt-2 text-sm text-[#7a8274]">
        {email}
        {memberSince ? ` · member since ${memberSince}` : ""}
      </p>
    </>
  );
}

/** A team member's stand-in for the plan and billing cards: whose team, and the way to the team page. */
export function TeamMemberSection({ teamName, suspended }: { teamName: string; suspended: boolean }) {
  return (
    <section className={CARD}>
      <h2 className="text-base font-semibold">Your team</h2>
      <p className="mt-1 text-sm text-[#7a8274]">
        You&apos;re a member of <span className="font-medium text-[#2e3d2b]">{teamName}</span>. The account owner manages funnels, integrations and billing.
      </p>
      {suspended && (
        <p className="mt-3 rounded-lg bg-[#fbf3e0] px-3 py-2 text-sm text-[#2e3d2b]">
          Your seat is paused because the team&apos;s balance is too low. It comes back automatically when the owner tops up.
        </p>
      )}
      <Link href={ACCOUNT_MORE.team.href} className="mt-3 inline-block text-sm underline">
        Team details
      </Link>
    </section>
  );
}

export function NotificationsSection() {
  return (
    <section className={CARD}>
      <h2 className="text-base font-semibold">Notifications</h2>
      <p className="mt-1 text-sm">
        <Link href="/account/notifications" className="underline">
          Choose which emails and texts we send you
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * What the member told us they are looking for, as the chips /picks shows,
 * and the one way to change it. Batch 12 replaces the editor behind
 * GOALS_EDITOR_HREF with the profile page.
 */
export function GoalsSection({ goals }: { goals: MarketGoals | null }) {
  // describeGoals never says whether they buy or rent, so that chip leads, as on /picks.
  const chips = goals ? [goals.dealTypes && goals.dealTypes.length > 0 ? describeTypes(goals.dealTypes) : goals.sourcingKind === "both" ? "Buy or rent-to-rent" : goals.sourcingKind === "rent" ? "Rent-to-rent" : "To buy", ...describeGoals(goals)] : [];
  return (
    <section className={CARD}>
      <h2 className="text-base font-semibold">What you’re looking for</h2>
      {goals ? (
        <>
          <p className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((chip, i) => (
              <span key={i} className={CHIP}>
                {chip}
              </span>
            ))}
          </p>
          <Link href={GOALS_EDITOR_HREF} className="mt-3 inline-block text-sm underline">
            Edit what you’re looking for
          </Link>
        </>
      ) : (
        <p className="mt-1 text-sm text-[#7a8274]">
          <Link href={GOALS_EDITOR_HREF} className="font-semibold text-[#2e3d2b] underline">
            Tell us what you’re looking for
          </Link>{" "}
          and today’s deals will be picked for you.
        </p>
      )}
    </section>
  );
}

/** Beside each door. The seat price is the team rules' own, never a second copy of it. */
const MORE_NOTES: Record<AccountMoreKey, string | null> = {
  team: `invite colleagues to work your leads (${formatGbp(SEAT_PRICE_PENCE).replace(".00", "")} a month each)`,
  leads: "enquiries from your white-label funnels, kept apart from your own reports",
  extension: null,
  markets: "area rankings & map",
  picks: "every property we have sent you",
  feedback: "what you’ve sent us and where it’s got to",
  calls: "calls from Stayful Intelligence and what they cost",
};

/** The secondary doors, deliberately quieter than the cards above: no card, small type. */
export function MoreSection({ keys, storeUrl }: { keys: AccountMoreKey[]; storeUrl: string | null }) {
  if (keys.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="account-more">
      <h2 id="account-more" className="text-xs font-semibold uppercase tracking-widest text-[#7a8274]">
        More
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm text-[#7a8274]">
        {keys.map((key) => (
          <li key={key}>
            <Link href={ACCOUNT_MORE[key].href} className="text-[#2e3d2b] underline">
              {ACCOUNT_MORE[key].label}
            </Link>
            {MORE_NOTES[key] ? ` · ${MORE_NOTES[key]}` : ""}
            {key === "extension" && storeUrl && (
              <>
                {" · "}
                <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Add to Chrome
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SignOutForm() {
  return (
    <form action={signOutAction} className="mt-6">
      <button
        type="submit"
        className="rounded-full border border-[#e4e7dc] bg-white px-5 py-2 text-sm font-semibold text-[#2e3d2b] transition hover:bg-[#f1f3ec]"
      >
        Sign out
      </button>
    </form>
  );
}
