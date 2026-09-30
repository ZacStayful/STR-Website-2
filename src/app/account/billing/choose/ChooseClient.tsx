"use client";

import { formatGbp } from "@/lib/credit/client";
import { StarterConfirm, type StarterChoice } from "@/components/credit/StarterConfirm";
import { TopupButtons } from "@/components/credit/TopupButtons";

const money = (p: number) => (p % 100 === 0 ? `£${Math.round(p / 100)}` : formatGbp(p));

/** The two choices, the one the email's button named first. Each is charged only by its own button. */
export function ChooseClient({ pick, starter, topupPence, card }: { pick: "starter" | "topup"; starter: StarterChoice | null; topupPence: number; card: { brand: string; last4: string } | null }) {
  const starterBox = starter ? (
    <section key="starter" className={`rounded-xl border p-5 ${pick === "starter" ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <StarterConfirm plan={starter} card={card} returnTo="/account/billing/choose" />
    </section>
  ) : null;
  const topupBox = (
    <section key="topup" className={`rounded-xl border p-5 ${pick === "topup" || !starter ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <p className="text-base font-semibold text-foreground">{starter ? "Or top up" : "Top up"} {money(topupPence)}</p>
      <p className="mt-1 text-sm text-muted-foreground">Credit that never expires. {card ? `On your card ending ${card.last4}, in one tap.` : "You’ll add a card on Stripe’s secure page; it’s saved for one-tap top-ups."}</p>
      <div className="mt-3">
        <TopupButtons presets={[topupPence]} hasSavedCard={Boolean(card)} via="low_credit" label={(p) => `Top up ${money(p)}`} />
      </div>
    </section>
  );
  return <div className="space-y-4">{pick === "topup" ? [topupBox, starterBox] : [starterBox, topupBox]}</div>;
}
