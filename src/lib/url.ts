export function siteUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://stayful.co.uk";
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Where every notification email's "Manage notifications" link points. */
export const MANAGE_NOTIFICATIONS_PATH = "/account/notifications";

/**
 * The manage link for an email. The pure builders take the site's base URL
 * as an argument (so tests can pass one); pass it through here, or leave it
 * out to use the configured site.
 */
export function manageNotificationsUrl(base?: string): string {
  if (!base) return siteUrl(MANAGE_NOTIFICATIONS_PATH);
  return `${base.replace(/\/$/, "")}${MANAGE_NOTIFICATIONS_PATH}`;
}
