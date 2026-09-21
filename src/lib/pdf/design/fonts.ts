import { Font } from "@react-pdf/renderer";
import { FONT_FILES, fontPath } from "./font-files";

export { FONT_FILES, FONT_DIR, fontPath } from "./font-files";

/**
 * Registers the report's two typefaces.
 *
 * These are the website's own typefaces — Inter and JetBrains Mono, at the
 * weights src/lib/marketing-fonts.ts loads — so the report and the site set
 * type identically.
 *
 * react-pdf cannot use `next/font` — it needs real font files at render time —
 * so the TTFs are committed under this folder and pinned into each serverless
 * bundle by `outputFileTracingIncludes` in next.config.ts. They live in `src/`
 * rather than `public/` deliberately: Vercel's static layer is not the
 * function's filesystem, so `public/` would need tracing anyway and would also
 * publish the files.
 *
 * `Font.register` is lazy: it does not read the file, and a wrong path throws
 * from inside `renderToBuffer` rather than here. The `existsSync` check below
 * is the only thing standing between a packaging mistake and a 500 on a
 * customer's report, so on failure this falls back to the PDF built-ins and
 * logs loudly. A plainer report beats no report.
 *
 * No `import "server-only"` on purpose — the sample-render script imports this
 * outside Next's module graph.
 */

export interface PdfFonts {
  sans: string;
  mono: string;
  /** False when the built-ins are standing in for the real thing. */
  custom: boolean;
}

const FALLBACK: PdfFonts = { sans: "Helvetica", mono: "Courier", custom: false };

let resolved: PdfFonts | null = null;

export function pdfFonts(): PdfFonts {
  if (resolved) return resolved;
  try {
    const paths = FONT_FILES.map((f) => {
      const p = fontPath(f);
      if (!p) throw new Error(`missing font file: ${f}`);
      return p;
    });
    const [sansRegular, sansMedium, sansSemiBold, monoRegular, monoMedium] = paths;

    Font.register({
      family: "ReportSans",
      fonts: [
        { src: sansRegular, fontWeight: 400 },
        { src: sansMedium, fontWeight: 500 },
        { src: sansSemiBold, fontWeight: 600 },
      ],
    });
    Font.register({
      family: "ReportMono",
      fonts: [
        { src: monoRegular, fontWeight: 400 },
        { src: monoMedium, fontWeight: 500 },
      ],
    });

    // react-pdf hyphenates by default. A hyphenated 30pt address headline is
    // the single ugliest thing this document could do.
    Font.registerHyphenationCallback((word) => [word]);

    resolved = { sans: "ReportSans", mono: "ReportMono", custom: true };
  } catch (err) {
    console.error(
      "[pdf] font registration failed; falling back to the PDF built-ins:",
      err,
    );
    resolved = FALLBACK;
  }
  return resolved;
}
