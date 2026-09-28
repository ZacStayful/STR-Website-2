import { leadsUpsellAction } from "../tailoring-actions";

/** Batch 14: for a management company looking for landlords and without a Leads page yet. */
export function LeadsUpsell() {
  return (
    <section aria-labelledby="leads-upsell" className="rounded-xl border border-border bg-card p-4">
      <h2 id="leads-upsell" className="text-sm font-semibold text-foreground">
        Want landlords to come to you?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Set up a Leads page and landlords looking for a manager can find you.</p>
      <form action={leadsUpsellAction} className="mt-3">
        <button type="submit" className="min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Set up a Leads page
        </button>
      </form>
    </section>
  );
}
