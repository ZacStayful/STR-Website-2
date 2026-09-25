"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { archiveLeadsAction, restoreLeadsAction, type LeadActionState } from "./lead-actions";
import { PushLeadButton } from "./PushLeadButton";

/** Everything a row shows, already formatted on the server. */
export interface LeadListRow {
  id: string;
  title: string;
  subtitle: string | null;
  address: string | null;
  enquired: string;
  facts: string[];
  revenue: string | null;
  stage: string;
  unqualifiedReason: string | null;
  unknownChecks: number;
  /** "Archives on …" / "deleted on …", or null when there is nothing to say. */
  retention: string | null;
  archived: boolean;
  canPush: boolean;
  pushed: boolean;
}

const INITIAL: LeadActionState = {};
const FORM_ID = "lead-bulk";

/**
 * The lead list, with tick-boxes for archiving (or, on the Archived tab,
 * restoring) several at once.
 *
 * Row links do not prefetch. Opening a lead counts as using it and resets
 * its retention clock, and that is recorded when the page is actually
 * viewed — but a prefetch of fifty leads is fifty server renders nobody
 * looked at, which is wasted work at best.
 */
export function LeadList({ rows, archivedTab }: { rows: LeadListRow[]; archivedTab: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(archivedTab ? restoreLeadsAction : archiveLeadsAction, INITIAL);

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The tick-boxes join this form through their `form` attribute rather than
  // by sitting inside it, so each row can keep its own "Send to CRM" form —
  // forms cannot nest.
  return (
    <div>
      <form
        id={FORM_ID}
        action={(fd) => {
          action(fd);
          setSelected(new Set());
        }}
        className="mb-2 flex flex-wrap items-center gap-3 text-xs"
      >
        <label className="flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={allOn}
            onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
            aria-label="Select all on this page"
          />
          Select all
        </label>
        <button
          type="submit"
          disabled={pending || selected.size === 0}
          onClick={(e) => {
            if (!archivedTab && !confirm(`Archive ${selected.size} lead${selected.size === 1 ? "" : "s"}? They will be deleted permanently after 7 days unless you restore them.`)) {
              e.preventDefault();
            }
          }}
          className="rounded-md border border-border px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-50"
        >
          {pending ? "Working…" : archivedTab ? `Restore selected (${selected.size})` : `Archive selected (${selected.size})`}
        </button>
        {state.notice ? <span className="text-muted-foreground" role="status">{state.notice}</span> : null}
        {state.error ? <span className="text-destructive" role="alert">{state.error}</span> : null}
      </form>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <input
              type="checkbox"
              form={FORM_ID}
              name="leadId"
              value={r.id}
              className="mt-1"
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              aria-label={`Select ${r.title}`}
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Link href={`/leads/${r.id}`} prefetch={false} className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline">
                  {r.title}
                </Link>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{r.stage}</span>
              </p>
              {r.subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.subtitle}</p> : null}
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.address ?? "No address recorded"}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span>Enquired {r.enquired}</span>
                {r.facts.map((f, i) => (
                  <span key={i}>· {f}</span>
                ))}
              </p>
              {r.unqualifiedReason ? <p className="mt-1 text-xs text-muted-foreground">{r.unqualifiedReason}</p> : null}
              {r.unknownChecks ? (
                <p className="mt-1 text-xs text-warning">
                  {r.unknownChecks} rule{r.unknownChecks === 1 ? "" : "s"} could not be checked.
                </p>
              ) : null}
              {r.retention ? <p className="mt-1 text-xs text-warning">{r.retention}</p> : null}
            </div>
            <div className="flex flex-col items-end gap-1.5 text-right">
              <div>
                <p className="text-sm font-semibold text-foreground">{r.revenue ?? "—"}</p>
                <p className="text-xs text-muted-foreground">projected gross</p>
              </div>
              {/* Only where it can do something: a queued lead has no report
                  to send, and a qualified one went automatically. */}
              {r.canPush ? <PushLeadButton leadId={r.id} pushed={r.pushed} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
