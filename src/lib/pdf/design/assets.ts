import fs from "node:fs";
import path from "node:path";

/**
 * The Stayful wordmark, as a data URI.
 *
 * Read once and cached: the logo appears on every page of every report, and
 * re-reading a 100KB PNG per page would be wasteful. react-pdf embeds the image
 * once regardless.
 *
 * Returns null if the file is not in the bundle, and the chrome falls back to a
 * text wordmark — the same fallback white-label reports already use when a
 * customer has not uploaded a logo.
 */

const LOGO = path.join(process.cwd(), "public", "assets", "stayful-logo.png");

let cached: string | null | undefined;

export function stayfulLogo(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = fs.existsSync(LOGO)
      ? `data:image/png;base64,${fs.readFileSync(LOGO).toString("base64")}`
      : null;
    if (cached === null) console.error("[pdf] wordmark missing from the bundle:", LOGO);
  } catch (err) {
    console.error("[pdf] could not read the wordmark:", err);
    cached = null;
  }
  return cached;
}
