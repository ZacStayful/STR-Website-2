import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { parseOfferRules, RULE_LIMITS, type PurchaseRule, type RentRule } from "@/lib/pipeline/offer-rules";
import { getStoredOfferRules } from "@/lib/pipeline/rules-server";
import { saveOfferRulesAction } from "./actions";

export const metadata: Metadata = { title: "Offer range — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  saved: { text: "Saved. Members see the new bands within a minute.", ok: true },
  bad: { text: "Not saved: every filled row needs a number in each box, a discount between 0 and 50%, and no more than 12 rows a kind.", ok: false },
  failed: { text: "Not saved: the setting could not be written. Try again.", ok: false },
};

const input = "w-24 rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * The offer range's discount bands (src/lib/pipeline/offer-rules.ts): how far
 * below asking the Offer stage suggests opening, by how long a listing has
 * been on the market and how often it has been cut. With no rows, the range
 * shows the member's target figure only.
 */
export default async function OfferRangeAdminPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/offer-range");
  if (!isAdminEmail(user.email)) notFound();

  const stored = await getStoredOfferRules();
  const rules = parseOfferRules(stored);
  const storedButInvalid = stored !== null && ((rules.purchase === null && hasRows(stored, "purchase")) || (rules.rentToRent === null && hasRows(stored, "rentToRent")));
  const purchase: (PurchaseRule | null)[] = padded(rules.purchase ?? []);
  const rent: (RentRule | null)[] = padded(rules.rentToRent ?? []);
  const message = msg ? MESSAGES[msg] ?? null : null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Offer range</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            At the Offer stage a member sees a suggested range: from the highest figure that still hits their own target, and the asking figure less the discount below. Each row reads &ldquo;on the market at least this long (and reduced at least this often) → open this far below asking&rdquo;. When a listing matches several rows, the biggest discount wins. Leave every row blank to switch the discount off: members then see their target figure only.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {message && <p className={"mb-4 rounded-md border p-3 text-sm " + (message.ok ? "border-primary/40 bg-primary/10 text-foreground" : "border-destructive/40 bg-destructive/10 text-destructive")}>{message.text}</p>}
      {storedButInvalid && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">The stored bands do not parse, so members see the target figure only. Save them again below.</p>}

      <form action={saveOfferRulesAction} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Purchase</h2>
          <p className="mt-1 text-xs text-muted-foreground">{rules.purchase ? `${rules.purchase.length} row${rules.purchase.length === 1 ? "" : "s"} in force.` : "Not set: purchase deals show the target figure only."}</p>
          <table className="mt-3 text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 pr-4">On the market at least (months)</th><th className="pr-4">Reduced at least (times)</th><th>Open below asking (%)</th></tr>
            </thead>
            <tbody>
              {purchase.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-4"><input name={`p_months_${i}`} type="number" step="0.5" min={0} max={RULE_LIMITS.maxMonths} defaultValue={r?.minMonths ?? ""} className={input} /></td>
                  <td className="pr-4"><input name={`p_reductions_${i}`} type="number" step="1" min={0} max={RULE_LIMITS.maxReductions} defaultValue={r?.minReductions ?? ""} className={input} /></td>
                  <td><input name={`p_pct_${i}`} type="number" step="0.5" min={0} max={RULE_LIMITS.maxDiscountPct} defaultValue={r?.discountPct ?? ""} className={input} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Rent-to-rent</h2>
          <p className="mt-1 text-xs text-muted-foreground">{rules.rentToRent ? `${rules.rentToRent.length} row${rules.rentToRent.length === 1 ? "" : "s"} in force.` : "Not set: rent-to-rent deals show the target figure only."}</p>
          <table className="mt-3 text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 pr-4">On the market at least (weeks)</th><th>Open below asking rent (%)</th></tr>
            </thead>
            <tbody>
              {rent.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-4"><input name={`r_weeks_${i}`} type="number" step="1" min={0} max={RULE_LIMITS.maxWeeks} defaultValue={r?.minWeeks ?? ""} className={input} /></td>
                  <td><input name={`r_pct_${i}`} type="number" step="0.5" min={0} max={RULE_LIMITS.maxDiscountPct} defaultValue={r?.discountPct ?? ""} className={input} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Save bands</button>
      </form>
    </div>
  );
}

function padded<T>(rows: T[]): (T | null)[] {
  return [...rows, ...Array.from({ length: Math.max(0, RULE_LIMITS.maxRows - rows.length) }, () => null)].slice(0, RULE_LIMITS.maxRows);
}

function hasRows(stored: unknown, key: string): boolean {
  const v = stored && typeof stored === "object" ? (stored as Record<string, unknown>)[key] : null;
  return Array.isArray(v) && v.length > 0;
}
