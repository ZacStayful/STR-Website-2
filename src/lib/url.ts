export function siteUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://stayful.co.uk";
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
