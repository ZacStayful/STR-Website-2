"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveWebhookAction, testConnectionAction, deleteConnectionAction, type CrmState } from "./actions";
import { StatusBadge, Feedback } from "./MondayPanel";

const INITIAL: CrmState = {};

interface Props {
  connection: {
    id: string;
    config: Record<string, unknown>;
    status: "unverified" | "ok" | "error";
    lastError: string | null;
    hasSecret: boolean;
    blockers: string[];
  } | null;
}

/**
 * The generic webhook — how a customer gets their leads into n8n, Zapier,
 * Make or anything else with a URL.
 *
 * The signing secret is shown exactly once, on the save that mints it, and
 * is encrypted at rest afterwards. That is deliberate: a secret we can read
 * back to a browser is a secret that can be read by anything that gets a
 * session, and it defeats the point of signing at all.
 */
export function WebhookPanel({ connection }: Props) {
  const [saveState, saveAction, saving] = useActionState(saveWebhookAction, INITIAL);
  const [testState, testAction, testing] = useActionState(testConnectionAction, INITIAL);
  const [, deleteAction, deleting] = useActionState(deleteConnectionAction, INITIAL);

  const url = typeof connection?.config.url === "string" ? connection.config.url : "";

  return (
    <section className="rounded-xl border border-border p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Webhook</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every lead is POSTed to your URL as signed JSON. Works with n8n, Zapier, Make, or your own server.{" "}
            <Link href="/leads/integrations/guide" className="underline underline-offset-2">Read the guide</Link>.
          </p>
        </div>
        <StatusBadge status={connection?.status ?? null} />
      </header>

      {connection?.lastError ? (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {connection.lastError}
        </p>
      ) : null}

      <form action={saveAction} className="mt-4 space-y-3">
        <input type="hidden" name="id" value={connection?.id ?? ""} />
        <label className="block">
          <span className="text-xs font-medium text-foreground">Your endpoint URL</span>
          <input
            name="url"
            type="url"
            required
            defaultValue={url}
            placeholder="https://your-n8n.example.com/webhook/stayful-leads"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Must be https. Leads carry a named person&apos;s contact details and home address, so we will not send
            them over an unencrypted connection.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : connection ? "Save" : "Connect webhook"}
          </button>
          {connection?.hasSecret ? (
            <button
              type="submit"
              name="rotate"
              value="1"
              disabled={saving}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-60"
            >
              Regenerate signing secret
            </button>
          ) : null}
        </div>

        {saveState.secret ? (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-semibold text-foreground">Your signing secret — copy it now</p>
            <code className="mt-1 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">
              {saveState.secret}
            </code>
            <p className="mt-1.5 text-xs text-muted-foreground">
              It is encrypted the moment you leave this page and cannot be shown again. Regenerating makes a new
              one and stops the old one working immediately.
            </p>
          </div>
        ) : null}
        <Feedback state={saveState} />
      </form>

      {connection ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <form action={testAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              disabled={testing}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
            >
              {testing ? "Sending…" : "Send a test"}
            </button>
          </form>
          <form action={deleteAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              disabled={deleting}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              Disconnect
            </button>
          </form>
          <span className="text-xs text-muted-foreground">
            A real, signed request — build your workflow against it before a prospect ever fills in the form.
          </span>
          <Feedback state={testState} />
        </div>
      ) : null}

      {connection && connection.blockers.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {connection.blockers.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
