import fs from "node:fs";
import path from "node:path";

/**
 * Where the report's typefaces live, kept apart from the registration itself so
 * a test can check they are present without pulling in react-pdf.
 */

export const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");

export const FONT_FILES = [
  "DMSans-Regular.ttf",
  "DMSans-Bold.ttf",
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
