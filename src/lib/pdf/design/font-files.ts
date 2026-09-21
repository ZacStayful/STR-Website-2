import fs from "node:fs";
import path from "node:path";

/**
 * Where the report's typefaces live, kept apart from the registration itself so
 * a test can check they are present without pulling in react-pdf.
 */

export const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");

/**
 * The same two families the website loads (see src/lib/marketing-fonts.ts),
 * at the same weights: Inter 400/500/600 and JetBrains Mono 400/500. Inter
 * stops at 600 on the site, so the report's headings are semibold rather than
 * bold — matching the site matters more than matching the heavier headline in
 * the reference PDF.
 */
export const FONT_FILES = [
  "Inter-Regular.ttf",
  "Inter-Medium.ttf",
  "Inter-SemiBold.ttf",
  "JetBrainsMono-Regular.ttf",
  "JetBrainsMono-Medium.ttf",
] as const;

/** Absolute path to a font file, or null when it is not in the bundle. */
export function fontPath(file: string): string | null {
  const full = path.join(FONT_DIR, file);
  try {
    return fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}
