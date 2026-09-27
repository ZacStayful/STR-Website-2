import type { Graphic } from "@/lib/profile/images";

/**
 * The quiz screens that get a built graphic rather than a photo
 * (src/lib/profile/images.ts): a map for the "where" questions, an icon for
 * the finance one, a sketch of a project for the "full project" card. All
 * decorative, all drawn in the page's own colours.
 */
export function QuizGraphic({ name, compact = false }: { name: Graphic; compact?: boolean }) {
  const cls = compact ? "aspect-[4/3] w-full rounded-xl bg-primary/5" : "aspect-[3/2] w-full rounded-2xl bg-primary/5";
  if (name === "map") return <MapGraphic className={cls} />;
  if (name === "icon") return <FinanceGraphic className={cls} />;
  return <ProjectGraphic className={cls} />;
}

/** A stylised map: a few areas, a pin and its radius. */
function MapGraphic({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 300 200" className={className} aria-hidden="true" role="presentation">
      <defs>
        <pattern id="mx-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="currentColor" strokeOpacity="0.08" />
        </pattern>
      </defs>
      <rect width="300" height="200" fill="url(#mx-grid)" className="text-primary" />
      <g className="text-primary" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeOpacity="0.35">
        <path d="M30 60c20-25 55-30 80-15s25 45 5 60-60 20-80 5-25-25-5-50z" />
        <path d="M150 30c25-15 60-5 75 15s5 50-15 60-55 5-70-10-15-50 10-65z" />
        <path d="M110 120c20-10 55-5 70 15s0 45-25 50-55-5-60-25 0-30 15-40z" />
      </g>
      <circle cx="165" cy="105" r="52" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeDasharray="4 4" className="text-primary" />
      <circle cx="165" cy="105" r="52" fill="currentColor" fillOpacity="0.08" className="text-primary" />
      <path d="M165 78c-9 0-16 7-16 16 0 12 16 30 16 30s16-18 16-30c0-9-7-16-16-16z" fill="currentColor" className="text-primary" />
      <circle cx="165" cy="94" r="6" fill="#fff" />
    </svg>
  );
}

/** Deposit and rate: a percent sign on a card, with a bar underneath. */
function FinanceGraphic({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 300 200" className={className} aria-hidden="true" role="presentation">
      <rect x="60" y="40" width="180" height="120" rx="16" fill="#fff" stroke="currentColor" strokeOpacity="0.25" className="text-primary" />
      <text x="150" y="112" textAnchor="middle" fontSize="56" fontWeight="700" fill="currentColor" className="text-primary" fontFamily="system-ui, sans-serif">
        %
      </text>
      <rect x="84" y="128" width="132" height="10" rx="5" fill="currentColor" fillOpacity="0.15" className="text-primary" />
      <rect x="84" y="128" width="33" height="10" rx="5" fill="currentColor" className="text-primary" />
    </svg>
  );
}

/** A house mid-project: bare walls, a ladder, a paint roller. */
function ProjectGraphic({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 300 200" className={className} aria-hidden="true" role="presentation">
      <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
        <path d="M70 100L150 40l80 60" />
        <path d="M90 90v80h120V90" />
        <path d="M130 170v-40h40v40" strokeDasharray="6 6" />
        <path d="M40 176l24-70M52 176l24-70M44 130h26M49 152h24" />
        <path d="M232 110h30v14h-30zM247 124v44" />
      </g>
    </svg>
  );
}
