/**
 * Batch 21 (C26): a report link that no longer works (unknown, purged, or a
 * report that has not run yet). Neutral: the prospect was sent here by a
 * customer, not by Stayful.
 */
export default function ReportNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-neutral-800">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold">This report is no longer available</h1>
        <p className="mt-3 text-sm text-neutral-600">It may still be being prepared, or the link has expired. Please check with whoever sent it to you.</p>
      </div>
    </main>
  );
}
