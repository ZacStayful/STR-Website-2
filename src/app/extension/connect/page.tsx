import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMarketAccess } from '@/lib/market/gate';
import { listExtensionTokens } from '@/lib/extension/tokens';
import { ConnectClient } from './ConnectClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect the browser extension — Stayful Intelligence',
  robots: { index: false, follow: false },
};

/**
 * Members only (proxy.ts sends anonymous visitors to /login). Mints a scoped
 * token the extension uses for /api/ext/*, hands it to the extension when the
 * extension id is configured, and lists connections so any can be revoked.
 */
export default async function ExtensionConnectPage() {
  const access = await getMarketAccess();
  if (!access.user) redirect('/login?redirect=/extension/connect');
  if (access.state !== 'ok') redirect('/upgrade?redirect=/extension/connect');
  const tokens = await listExtensionTokens(access.user.id);
  const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID ?? null;

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Stayful browser extension</p>
        <h1 className="mt-1 text-2xl font-bold">Connect the extension</h1>
        <p className="mt-2 text-sm text-[#7a8274]">
          The extension shows a Stayful quick view on Rightmove, Zoopla, OnTheMarket, Airbnb and Booking.com listing pages and saves what you check to your pipeline. It signs in with a token that only works for the extension and can be revoked here at any time.
        </p>
        <ConnectClient extensionId={extensionId} tokens={tokens} />
        <p className="mt-8 text-xs text-[#7a8274]">
          Not installed yet? <Link href="/extension" className="underline">Get the extension</Link>. Read the <Link href="/extension/privacy" className="underline">extension privacy notes</Link>.
        </p>
      </div>
    </main>
  );
}
