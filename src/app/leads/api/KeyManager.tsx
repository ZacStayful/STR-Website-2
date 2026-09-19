"use client";

import { useActionState } from "react";
import { mintKeyAction, revokeKeyAction, type KeyState } from "./actions";
import { SCOPES, SCOPE_LABELS, READ_ONLY_SCOPES, spendsCredit, type Scope } from "@/lib/api/scopes";

const INITIAL: KeyState = {};

export interface KeyRow {
  id: string;
  label: string | null;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt: string | null;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function KeyManager({ keys }: { keys: KeyRow[] }) {
  const [mintState, mintAction, minting] = useActionState(mintKeyAction, INITIAL);
  const [revokeState, revokeAction, revoking] = useActionState(revokeKeyAction, INITIAL);

  return (
    <>
      <form action={mintAction} className="rounded-xl border border-border p-5">
        <h2 className="text-base font-semibold text-foreground">Create a key</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A key does exactly what you tick here and nothing more. Ticking nothing that spends credit gives you a
          key that can read everything and cost you nothing — which is what you want before pasting one into an
          agent you do not control.
        </p>

        <label className="mt-4 block">
          <span className="text-xs font-medium text-foreground">Name it</span>
          <input
            name="label"
            maxLength={80}
            placeholder="e.g. Claude desktop, or Weekly lead report"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            So you know which one to revoke later.
          </span>
        </label>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-foreground">What may it do?</legend>
          <div className="mt-2 space-y-1.5">
            {SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="scopes"
                  value={s}
                  defaultChecked={READ_ONLY_SCOPES.includes(s)}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-foreground">{SCOPE_LABELS[s]}</span>
                  <code className="ml-2 rounded bg-muted px-1 text-xs text-muted-foreground">{s}</code>
                  {spendsCredit([s]) ? (
                    <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                      spends credit
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={minting}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {minting ? "Creating…" : "Create key"}
        </button>

        {mintState.key ? (
          <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-semibold text-foreground">{mintState.notice}</p>
            <code className="mt-1 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">
              {mintState.key}
            </code>
            <p className="mt-1.5 text-xs text-muted-foreground">
              We store only a hash of it, so we cannot show it to you again — and nobody reading our database can
              use it either. Lose it and you make a new one.
            </p>
          </div>
        ) : null}
        {mintState.error ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {mintState.error}
          </p>
        ) : null}
      </form>

      <section className="mt-5 rounded-xl border border-border p-5">
        <h2 className="text-base font-semibold text-foreground">Your keys</h2>
        {keys.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{k.label ?? "Unnamed key"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {when(k.createdAt)} · last used {when(k.lastUsedAt)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <code
                        key={s}
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          s === "analyse" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {s}
                      </code>
                    ))}
                  </p>
                </div>
                <form action={revokeAction}>
                  <input type="hidden" name="id" value={k.id} />
                  <button
                    type="submit"
                    disabled={revoking}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {revokeState.notice ? <p className="mt-3 text-xs text-muted-foreground">{revokeState.notice}</p> : null}
        {revokeState.error ? <p className="mt-3 text-xs text-destructive">{revokeState.error}</p> : null}
      </section>
    </>
  );
}
