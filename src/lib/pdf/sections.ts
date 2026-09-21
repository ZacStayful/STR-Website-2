/**
 * Which sections a report contains, and how they are numbered.
 *
 * The reference design stamps "03 / 06 — THE MARKET" in the running header and
 * lists the remaining sections on page 1, so the totals cannot be hardcoded:
 * the setup and deal pages are conditional. Numbering therefore counts
 * *sections*, resolved once up front, rather than physical sheets. That also
 * means a page which wraps onto a continuation sheet keeps its own number
 * instead of silently shifting every page after it.
 */

export type SectionId =
  | "verdict"
  | "numbers"
  | "market"
  | "location"
  | "setup"
  | "deal"
  | "plan";

export interface Section {
  id: SectionId;
  label: string;
}

export interface Nav {
  /** 1-based position among the sections actually present. */
  index: number;
  total: number;
  label: string;
}

/**
 * Document order. `plan` is last on purpose — it carries the call to action and
 * has to be the final thing a reader sees. `deal` is an appendix to the
 * economics, so it sits after the setup costs.
 */
const ALL: readonly Section[] = [
  { id: "verdict", label: "THE VERDICT" },
  { id: "numbers", label: "THE NUMBERS" },
  { id: "market", label: "THE MARKET" },
  { id: "location", label: "LOCATION & RISK" },
  { id: "setup", label: "SETUP COSTS" },
  { id: "deal", label: "THE DEAL" },
  { id: "plan", label: "THE PLAN" },
];

export interface SectionAvailability {
  setup: boolean;
  deal: boolean;
}

export function sectionsFor(has: SectionAvailability): Section[] {
  return ALL.filter((s) =>
    s.id === "setup" ? has.setup : s.id === "deal" ? has.deal : true,
  );
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function navFor(sections: Section[], id: SectionId): Nav {
  const index = sections.findIndex((s) => s.id === id);
  if (index === -1) {
    // Asking for a section that was filtered out is a programming error, but a
    // thrown error here would fail the whole render. Degrade to a blank stamp.
    return { index: 0, total: sections.length, label: "" };
  }
  return { index: index + 1, total: sections.length, label: sections[index].label };
}

/** `03 / 06 — THE MARKET`, for the running header. */
export const stamp = (nav: Nav): string =>
  `${pad2(nav.index)} / ${pad2(nav.total)} — ${nav.label}`;

/** `03 / 06`, for the footer. */
export const stampShort = (nav: Nav): string =>
  `${pad2(nav.index)} / ${pad2(nav.total)}`;

/** `05 — SETUP COSTS`, the eyebrow above each page's headline. */
export const eyebrow = (nav: Nav): string => `${pad2(nav.index)} — ${nav.label}`;

/** The sections page 1 lists at its foot: everything after the verdict. */
export const contentsFor = (sections: Section[]): Section[] => sections.slice(1);
