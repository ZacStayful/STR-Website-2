// 2025 "estimate vs actual" proof points, matching the figures Stayful uses in
// its live owner presentations. `file` links to a case-study PDF in /public
// where one exists for that city.

export interface CaseStudy {
  city: string;
  estimate: number; // monthly, tool estimate
  actual: number; // monthly, actual achieved
  file?: string;
}

export const CASE_STUDIES: CaseStudy[] = [
  { city: "Manchester", estimate: 2997, actual: 2997, file: "/case-studies/Stayful_CaseStudy_X1_Eastbank_Tower_Great_Ancoats_Street_Manchester.pdf" },
  { city: "York", estimate: 2278, actual: 2545, file: "/case-studies/Stayful_CaseStudy_17_Park_Crescent_York.pdf" },
  { city: "Leeds", estimate: 2713, actual: 3085 },
  { city: "Lincoln", estimate: 1611, actual: 1852 },
];

// Average accuracy: how close the tool estimate was to the actual result.
export function averageAccuracy(): number {
  const ratios = CASE_STUDIES.map((c) => Math.min(c.estimate, c.actual) / Math.max(c.estimate, c.actual));
  return Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100);
}
