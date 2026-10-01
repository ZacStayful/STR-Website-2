"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The page a member sees when a render throws (a database blip, a provider
 * that did not answer). Branded, with a retry and a way to Today, instead of
 * Next's bare "Application error". The error itself goes to the console and
 * to Vercel's logs, never to the member: a stack can carry an address or an
 * email.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page] render failed:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Stayful Intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That page could not be shown just now. Showing a page never charges credit. Try again, or come back in a minute.
          {error.digest ? <span className="mt-2 block text-xs">Reference {error.digest}</span> : null}
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => reset()} className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Try again
          </button>
          <Link href="/today" className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted">
            Go to Today
          </Link>
        </div>
      </div>
    </main>
  );
}
