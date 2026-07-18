import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAreaDetail, listAreaCodes } from "@/lib/market/explorer";
import { areaMetaForCode, areaMetaForSlug } from "@/lib/market/areas";
import { getLicensing } from "@/lib/data/str-licensing";
import { gbp, pct } from "@/lib/market/format";
import { siteUrl } from "@/lib/url";
import { LicensingBadge } from "../_components/LicensingBadge";
import { VerdictLabel } from "../_components/VerdictLabel";
import { ArrowRight } from "lucide-react";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const codes = await listAreaCodes();
  return codes.map((code) => ({ area: areaMetaForCode(code).slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>;
}): Promise<Metadata> {
  const { area: slug } = await params;
  const meta = areaMetaForSlug(slug);
  const name = meta?.name ?? slug;
  const detail = meta ? await getAreaDetail(meta.code) : null;

  const title = `${name} Short-Term Rental Yields & Investment Data | Stayful`;
  const description = detail
    ? `Short-term rental data for ${name} (${detail.card.code}): ${gbp(detail.card.headline.grossRevenue)} avg revenue, ${pct(detail.card.headline.occupancy, 0)} occupancy${detail.card.yieldOnCost ? `, ${pct(detail.card.yieldOnCost.grossYieldPct, 1)} gross yield-on-cost` : ""}, plus licensing rules and short-vs-long-let. Free area report from Stayful.`
    : `Short-term rental investment data and licensing rules for ${name}. Explore UK STR areas free with Stayful Market Explorer.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: siteUrl(`/markets/${meta?.slug ?? slug}`) },
    openGraph: { title, description, url: siteUrl(`/markets/${meta?.slug ?? slug}`) },
  };
}

export default async function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area: slug } = await params;
  const meta = areaMetaForSlug(slug);
  // A truly unknown slug (not a mapped city, not a valid postcode-area code) 404s.
  if (!meta) notFound();
  const detail = await getAreaDetail(meta.code);

  // ── Not-enough-data state (area no longer meets min_samples, or never did) ──
  if (!detail) {
    const name = meta.name;
    const licensing = getLicensing(meta.code);
    return (
      <div className="mx-container">
        <div className="mx-detail-hero">
          <div className="mx-breadcrumb"><Link href="/markets">← All areas</Link></div>
          <h1>{name}</h1>
        </div>
        <div className="mx-empty">
          <h2>Not enough data yet for {name}</h2>
          <p>
            We don’t have enough short-term-let samples in this area to show reliable
            averages yet. As more Stayful analyser reports come in for {name}, this page
            will fill in.
          </p>
        </div>
        {licensing && (
          <div className="mx-panel" style={{ marginTop: 18 }}>
            <h2>Licensing &amp; regulation</h2>
            <LicensingBadge status={licensing.status} />
            <p style={{ marginTop: 12 }}>{licensing.detail}</p>
          </div>
        )}
        <div className="mx-cta-row">
          <Link href="/estimate" className="mx-cta">Analyse a specific address <ArrowRight size={16} /></Link>
        </div>
      </div>
    );
  }

  const { card, area } = detail;
  const h = card.headline;
  const y = card.yieldOnCost;
  const v = card.verdict;
  const lic = card.licensing;

  return (
    <div className="mx-container">
      <div className="mx-detail-hero">
        <div className="mx-breadcrumb"><Link href="/markets">← All areas</Link> · {card.code} postcode area</div>
        <h1>{card.name} short-term rental market</h1>
        <LicensingBadge status={lic.status} label={lic.headline} />
      </div>

      {/* ── Headline stats (server-rendered into HTML) ── */}
      <div className="mx-bigstats">
        <div className="mx-bigstat">
          <div className="v">{gbp(h.grossRevenue)}</div>
          <div className="l">Avg gross revenue / yr</div>
        </div>
        <div className="mx-bigstat">
          <div className="v">{gbp(h.adr)}</div>
          <div className="l">Average daily rate</div>
        </div>
        <div className="mx-bigstat">
          <div className="v">{pct(h.occupancy, 0)}</div>
          <div className="l">Occupancy</div>
        </div>
        <div className="mx-bigstat">
          <div className="v">{y ? pct(y.grossYieldPct, 1) : "—"}</div>
          <div className="l">Gross yield-on-cost</div>
          {y ? (
            <div className="sub">on ~{gbp(y.propertyValueMid)} property value</div>
          ) : (
            <div className="sub">no area property-value data</div>
          )}
        </div>
      </div>

      {/* ── Short vs long-let verdict ── */}
      <div className="mx-panel">
        <h2>Short-let vs long-let</h2>
        <p><VerdictLabel verdict={v} /></p>
        {v ? (
          <table className="mx-table">
            <tbody>
              <tr><td>Short-let net income / yr</td><td>{gbp(v.financials.shortLetNetAnnual)}</td></tr>
              <tr><td>Long-let net income / yr</td><td>{gbp(v.financials.longLetNetAnnual)}</td></tr>
              <tr><td>Area long-let rent (PropertyData)</td><td>{gbp(v.longLetMonthlyRent)}/mo</td></tr>
              <tr><td>Break-even occupancy</td><td>{v.breakEvenOccupancyPct}%</td></tr>
            </tbody>
          </table>
        ) : (
          <p style={{ color: "var(--mx-muted)" }}>
            We couldn’t fetch an area long-let comparator for {card.name}, so the
            short-vs-long verdict isn’t available for this area yet.
          </p>
        )}
      </div>

      {/* ── Per-bedroom breakdown ── */}
      <div className="mx-panel">
        <h2>By bedroom count</h2>
        <table className="mx-table">
          <thead>
            <tr>
              <th>Beds</th><th>Samples</th><th>ADR</th><th>Occupancy</th><th>Gross rev</th><th>Property value</th>
            </tr>
          </thead>
          <tbody>
            {area.by_bedrooms.map((b) => (
              <tr key={b.bedrooms}>
                <td>{b.bedrooms}</td>
                <td>{b.sample_count}</td>
                <td>{gbp(b.avg_adr)}</td>
                <td>{pct(b.avg_occupancy, 1)}</td>
                <td>{gbp(b.avg_gross_revenue)}</td>
                <td>
                  {b.avg_property_value_low !== null && b.avg_property_value_high !== null
                    ? `${gbp(b.avg_property_value_low)}–${gbp(b.avg_property_value_high)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Licensing & regulation ── */}
      <div className="mx-panel">
        <h2>Licensing &amp; regulation</h2>
        <LicensingBadge status={lic.status} />
        <p style={{ marginTop: 12 }}>{lic.detail}</p>
        {lic.changeIncoming && <p className="mx-note">Heads-up: {lic.changeIncoming}</p>}
        {lic.straddle && (
          <p className="mx-note">
            This postcode area straddles a jurisdiction boundary, so rules can differ
            within it — treat this as unconfirmed and check the specific local authority.
          </p>
        )}
        {lic.sources.length > 0 && (
          <div className="mx-sources">
            Sources:{" "}
            {lic.sources.map((s, i) => (
              <span key={s}>
                {i > 0 && " · "}
                <a href={s} target="_blank" rel="noopener noreferrer">{new URL(s).hostname}</a>
              </span>
            ))}
            <div>Last verified: {lic.lastVerified}</div>
          </div>
        )}
      </div>

      {/* ── CTA into the (Pro-gated) address analyser — the only paywall boundary ── */}
      <div className="mx-panel" style={{ background: "var(--mx-sage-mint)", borderColor: "var(--mx-sage-mint)" }}>
        <h2>Analyse a specific property in {card.name}</h2>
        <p>
          These are area averages. To model a specific address — with its own comparables,
          risk profile and 12-month forecast — run it through the Stayful analyser.
        </p>
        <div className="mx-cta-row">
          <Link href="/estimate" className="mx-cta">Analyse an address <ArrowRight size={16} /></Link>
        </div>
      </div>

      <p className="mx-disclaimer">
        {card.name} figures are averages from {h.totalSamples} Stayful analyser samples
        across the {card.code} postcode area — indicative, not a guarantee of returns.
        Licensing is a general guide; confirm with the local authority before buying.
      </p>
    </div>
  );
}
