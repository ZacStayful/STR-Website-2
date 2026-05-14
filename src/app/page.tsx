import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Stayful Intelligence · Short-term rental analyser',
  description:
    'Make confident short-term rental investment decisions. Sign up for a 14-day free trial and run unlimited property analyses.',
}

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

export default async function HomePage() {
  let signedIn = false
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    signedIn = Boolean(user)
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="font-semibold text-sm">
            Stayful Intelligence
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            {signedIn ? (
              <Link
                href="/estimate"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground font-medium hover:bg-primary/90"
              >
                Open analyser
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground font-medium hover:bg-primary/90"
                >
                  Start free trial
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pt-20 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
          Know exactly what a short-term let will earn
          <span className="block text-primary">before you buy it.</span>
        </h1>
        <p className="mt-6 mx-auto max-w-2xl text-lg text-muted-foreground">
          Stayful Intelligence pulls real Airbnb comparables, long-let
          benchmarks and local demand signals into one risk-scored verdict.
          Run unlimited analyses on a 14-day free trial. No card required.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={signedIn ? '/estimate' : '/signup'}
            className="inline-flex h-11 items-center rounded-lg bg-primary px-6 text-primary-foreground font-medium hover:bg-primary/90"
          >
            {signedIn ? 'Open analyser' : 'Start your free trial'}
          </Link>
          <Link
            href="/demo"
            className="inline-flex h-11 items-center rounded-lg border border-border px-6 font-medium hover:bg-muted"
          >
            See a sample analysis
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-24 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          {
            title: 'Real comparables',
            body: 'Live Airbnb data via Airbtics. Compare your property against nearby actives on price, occupancy and seasonality.',
          },
          {
            title: 'Long-let benchmark',
            body: 'PropertyData feeds an apples-to-apples long-let estimate so you can see the real upside (or downside) of going short.',
          },
          {
            title: 'Risk-scored verdict',
            body: 'Demand signals from Google Places and Ticketmaster, weighted into a clear verdict and a downloadable report.',
          },
        ].map((f) => (
          <div key={f.title} className="rounded-2xl border border-border p-6">
            <h2 className="text-base font-semibold text-foreground">
              {f.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted-foreground flex items-center justify-between">
          <span>&copy; {new Date().getFullYear()} Stayful Intelligence</span>
          <Link href="/report" className="hover:text-foreground">
            Get a copy of your report
          </Link>
        </div>
      </footer>
    </main>
  )
}
