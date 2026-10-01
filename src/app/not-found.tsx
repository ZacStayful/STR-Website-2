import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Every notFound() in the app lands here: a withdrawn link, a deal still in
 * early access for an account that has never paid, a report that is not the
 * member's, /admin for anyone else. Branded, with a way to Today and the
 * home page, and no hint about what the page was: the copy is the same for
 * the admin area, so it stays hidden.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Stayful Intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">That page isn’t here</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          It may have been removed, or the link was mistyped. Your deals and reports are where they were.
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link href="/today" className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Go to Today
          </Link>
          <Link href="/" className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
