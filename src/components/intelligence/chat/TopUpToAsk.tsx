import Link from "next/link";

/** Batch 26: "Top up to ask me more" (the tap-to-ask chips stay free). A team member's top-ups are their owner's. */
export function TopUpToAsk({ teamMember, tone = "dark" }: { teamMember: boolean; tone?: "dark" | "light" }) {
  const text = tone === "dark" ? "text-white" : "text-foreground";
  return (
    <div className={`rounded-xl ${tone === "dark" ? "bg-white/10" : "bg-muted"} p-4 text-sm ${text}`} role="status">
      {teamMember ? (
        <p>Your team is out of credit for questions. Ask your team owner to top up.</p>
      ) : (
        <>
          <p>Top up to ask me more.</p>
          <Link href="/account/billing#topup" className="mt-3 inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90">
            Top up
          </Link>
        </>
      )}
    </div>
  );
}
