import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listApiKeys } from "@/lib/api/keys";
import { siteUrl } from "@/lib/url";
import { ROUTES } from "@/lib/api/openapi";
import { KeyManager } from "./KeyManager";

export const metadata: Metadata = {
  title: "API & MCP — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Keys, endpoints and the MCP connection details.
 *
 * Lives under Leads rather than Account because everything a key is for —
 * leads, funnels, qualification rules — is here, and a customer looking for
 * "how do I get my leads into my own tooling" looks where the leads are.
 */
export default async function ApiPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const keys = await listApiKeys(user.id);
  const base = siteUrl();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">API &amp; MCP</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drive Stayful from your own tooling, or hand an AI agent a key and let it read your leads, run
            analyses and change your qualification rules for you.
          </p>
        </div>

        <KeyManager keys={keys} />

        <section className="mt-5 rounded-xl border border-border p-5">
          <h2 className="text-base font-semibold text-foreground">Connect an AI agent</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing to install. Add this as a remote MCP server in Claude, or anything else that speaks MCP, and
            paste a key as the bearer token.
          </p>
          <code className="mt-3 block break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
            {base}/api/mcp
          </code>
          <p className="mt-2 text-xs text-muted-foreground">
            The agent can then do exactly what the key allows and no more. A key without{" "}
            <code className="rounded bg-muted px-1">analyse</code> cannot spend a penny.
          </p>
        </section>

        <section className="mt-5 rounded-xl border border-border p-5">
          <h2 className="text-base font-semibold text-foreground">REST endpoints</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Base <code className="rounded bg-muted px-1">{base}/api/v1</code>, authenticated with{" "}
            <code className="rounded bg-muted px-1">Authorization: Bearer sfk_…</code>. The full description is at{" "}
            <a href="/api/v1/openapi.json" className="underline underline-offset-2">openapi.json</a>, which most
            tools can import directly.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Endpoint</th>
                  <th className="py-1.5 pr-3 font-medium">What it does</th>
                  <th className="py-1.5 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ROUTES.map((r) => (
                  <tr key={`${r.method} ${r.path}`}>
                    <td className="py-1.5 pr-3 align-top font-mono text-foreground">
                      <span className="text-muted-foreground">{r.method.toUpperCase()}</span> {r.path}
                    </td>
                    <td className="py-1.5 pr-3 align-top text-muted-foreground">
                      {r.summary}
                      {r.spends ? <span className="ml-1.5 text-warning">· spends credit</span> : null}
                    </td>
                    <td className="py-1.5 align-top">
                      {r.scope ? (
                        <code className="rounded bg-muted px-1 text-muted-foreground">{r.scope}</code>
                      ) : (
                        <span className="text-muted-foreground">any key</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Leads and reports are separate throughout: leads come from strangers completing your funnel, reports
            are properties you chose to research, and no endpoint returns both.
          </p>
        </section>

        <p className="mt-6 text-xs text-muted-foreground">
          Looking to push leads into a CRM instead? That is{" "}
          <Link href="/leads/integrations" className="underline underline-offset-2">Integrations</Link> — no code
          required.
        </p>
      </div>
    </main>
  );
}
