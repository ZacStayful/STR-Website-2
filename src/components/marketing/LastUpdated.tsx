export function LastUpdated({ date }: { date: string }) {
  const formatted = new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <p className="sf-last-updated">
      Last updated: <time dateTime={date}>{formatted}</time>
    </p>
  );
}
