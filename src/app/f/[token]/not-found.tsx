/**
 * Batch 21 (C26): a funnel link that no longer works. Neutral on purpose:
 * this URL belongs to a customer's campaign, so it names nobody and links
 * nowhere.
 */
export default function FunnelNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-neutral-800">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold">This link is no longer available</h1>
        <p className="mt-3 text-sm text-neutral-600">The page you were sent to has been taken down or the address is incomplete. Please check with whoever sent it to you.</p>
      </div>
    </main>
  );
}
