"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toggleFunnelAction, type FunnelState } from "../../actions";
import { emailDemoAction, recordSnippetAction, type DemoState } from "../actions";
import { ErrorLine, primaryBtn } from "../ui";
import type { SnippetKind } from "@/lib/funnels/snippets";

const INITIAL: FunnelState = {};
const DEMO_INITIAL: DemoState = {};

function CopyBlock({ label, value, kind, multiline }: { label: string; value: string; kind: SnippetKind; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        {multiline ? (
          <textarea readOnly value={value} rows={3} className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 p-2 font-mono text-xs text-foreground" onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input readOnly value={value} className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 py-2 font-mono text-xs text-foreground" onFocus={(e) => e.currentTarget.select()} />
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            );
            void recordSnippetAction(kind);
          }}
          className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Batch 22f: the finish — go live, then the link, the button, the embed, and what a landlord gets. */
export function LiveStep({ funnelId, active, blockers, url, previewUrl, button, embed }: { funnelId: string; active: boolean; blockers: string[]; url: string; previewUrl: string; button: string; embed: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(toggleFunnelAction, INITIAL);
  const [demo, demoAction, sending] = useActionState(emailDemoAction, DEMO_INITIAL);
  useEffect(() => {
    if (state.saved) router.refresh();
  }, [state.saved, router]);

  return (
    <div className="space-y-8">
      {!active ? (
        <section className="space-y-3">
          {blockers.length > 0 ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              Your form is saved but paused. Before it can go live, add {blockers.join(" and ")}:{" "}
              <Link href="/leads/setup/details" className="underline underline-offset-2">add it here</Link>. Landlords are giving their details to
              you, so they need somewhere to read how you&apos;ll use them.
            </p>
          ) : null}
          <form action={action}>
            <input type="hidden" name="id" value={funnelId} />
            <button type="submit" disabled={pending || blockers.length > 0} className={primaryBtn}>
              {pending ? "Going live…" : "Go live"}
            </button>
          </form>
          <ErrorLine state={state} />
        </section>
      ) : (
        <section className="space-y-5 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">Live: put it anywhere landlords find you.</p>
          <CopyBlock label="Your link" value={url} kind="link" />
          <div>
            <CopyBlock label="A button for your website" value={button} kind="button" multiline />
            <div className="mt-2" dangerouslySetInnerHTML={{ __html: button }} />
          </div>
          <CopyBlock label="Or the whole form on your page" value={embed} kind="embed" multiline />
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-base font-semibold text-foreground">See what a landlord gets</h2>
        <p className="text-sm text-muted-foreground">The report in your branding, with demo figures. Nothing is charged.</p>
        <div className="flex flex-wrap gap-3">
          <a href={previewUrl} target="_blank" rel="noopener" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
            Open the sample report
          </a>
          <form action={demoAction}>
            <input type="hidden" name="id" value={funnelId} />
            <button type="submit" disabled={sending || demo.sent} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60">
              {sending ? "Sending…" : demo.sent ? "Sent: check your inbox" : "Email it to me"}
            </button>
          </form>
        </div>
        {demo.error ? <p role="alert" className="text-sm text-destructive">{demo.error}</p> : null}
      </section>
    </div>
  );
}
