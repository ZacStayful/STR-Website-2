"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ExternalLink, FileText, X } from "lucide-react";
import { removeCheckedListingAction, shareListingAction, unshareListingAction, updateListingNotesAction, updateListingStatusAction } from "../../actions";
import { PIPELINE_STATUSES, type CheckedListingRow, type PipelineStatus } from "@/lib/listing/pipeline";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { DEFAULT_COSTS } from "@/lib/listing/deal";
import type { Verdict } from "@/lib/listing/verdict";
import { gbp, gbpCompact } from "@/lib/market/format";
import { trendLabel } from "@/lib/market/trend";
import type { ExplorerRow } from "./types";
import { KeyTiles, Kv, VerdictBlock, Working } from "./VerdictBits";
import { ListingThumb, listingMeta } from "./ListingsPane";

const LISTING_STATUS_LABEL: Record<string, string> = { under_offer: "Under offer", let_agreed: "Let agreed", sold: "Sold", removed: "Removed from the market" };
const SOURCE_LABEL: Record<string, string> = { "postcode-reports": "Recent Stayful reports for this postcode", competitors: "Tracked Airbnbs within 1 km", "area-bedrooms": "Area average for this size", area: "Area average across all sizes", "pmi-market": "Property Market Intel area snapshot" };

/** Tracked competitors around the listing as dots, the listing at the centre. */
function MiniMap({ listing }: { listing: CheckedListingRow }) {
  const comps = listing.quick?.competitors?.top ?? [];
  if (listing.lat === null || listing.lng === null || comps.length === 0) return null;
  const lat0 = listing.lat;
  const lng0 = listing.lng;
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos((lat0 * Math.PI) / 180);
  const R = 1.15; // km shown from centre to edge
  const pos = (lat: number, lng: number) => ({ x: 50 + ((lng - lng0) * kmPerDegLng * 50) / R, y: 50 - ((lat - lat0) * kmPerDegLat * 50) / R });
  const me = listing.quick?.tracked?.listingId ?? null;
  const meDrawn = me !== null && comps.some((c) => c.listingId === me);
  return (
    <div className="mx-minimap" role="img" aria-label={`${comps.length} tracked Airbnbs near this listing`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle cx="50" cy="50" r="43" className="mx-minimap-ring" />
        {comps.map((c) => {
          const p = pos(c.lat, c.lng);
          if (p.x < 2 || p.x > 98 || p.y < 2 || p.y > 98) return null;
          const isMe = c.listingId === me;
          return (
            <g key={c.listingId}>
              <circle cx={p.x} cy={p.y} r={isMe ? 3.2 : 2.2} className={isMe ? "mx-minimap-me" : "mx-minimap-dot"}>
                <title>{`${c.name} · ${gbp(c.annualRevenue)} / yr`}</title>
              </circle>
            </g>
          );
        })}
        {!meDrawn && <circle cx="50" cy="50" r="3.2" className="mx-minimap-me"><title>This listing</title></circle>}
      </svg>
      <ul className="mx-minimap-list">
        {comps.slice(0, 5).map((c) => (
          <li key={c.listingId}><a href={c.url} target="_blank" rel="noopener noreferrer">{c.name.slice(0, 34)}</a> <b>{gbpCompact(c.annualRevenue)}</b>{c.distanceKm !== undefined ? ` · ${c.distanceKm} km` : ""}</li>
        ))}
      </ul>
    </div>
  );
}

export function ListingDrawer({
  listing,
  verdict,
  areaRow,
  areaFit,
  comparing,
  compareDisabled,
  onClose,
  onChange,
  onRemoved,
  onOpenArea,
  onToggleCompare,
}: {
  listing: CheckedListingRow;
  verdict: Verdict;
  areaRow: ExplorerRow | null;
  areaFit: number | null;
  comparing: boolean;
  compareDisabled: boolean;
  onClose: () => void;
  /** Merges a partial update into the listing (functional, so in-flight edits never clobber each other). */
  onChange: (id: string, patch: Partial<CheckedListingRow>) => void;
  onRemoved: (id: string) => void;
  onOpenArea: (code: string) => void;
  onToggleCompare: () => void;
}) {
  const [notes, setNotes] = useState(listing.notes);
  const [message, setMessage] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, start] = useTransition();
  const sharePath = listing.shareToken ? `/deal/${listing.shareToken}` : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- origin is only known in the browser; SSR renders the path
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) setMenu(false);
      else onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (menu && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, menu]);

  const setStatus = (s: PipelineStatus) => {
    const prev = listing.status;
    onChange(listing.id, { status: s });
    start(async () => {
      const r = await updateListingStatusAction(listing.id, s);
      if ("error" in r) {
        onChange(listing.id, { status: prev });
        setMessage(r.error);
      }
    });
  };
  const saveNotes = () => {
    if (notes === listing.notes) return;
    onChange(listing.id, { notes });
    start(async () => {
      const r = await updateListingNotesAction(listing.id, notes);
      setMessage("error" in r ? r.error : "Notes saved");
    });
  };
  const share = () => {
    setMenu(false);
    start(async () => {
      if (listing.shareToken) {
        const r = await unshareListingAction(listing.id);
        if ("error" in r) setMessage(r.error);
        else {
          onChange(listing.id, { shareToken: null });
          setMessage("Share link revoked");
        }
        return;
      }
      const r = await shareListingAction(listing.id);
      if ("error" in r) setMessage(r.error);
      else {
        onChange(listing.id, { shareToken: r.token });
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/deal/${r.token}`);
          setMessage("Share link copied");
        } catch {
          setMessage("Share link created");
        }
      }
    });
  };
  const remove = () => {
    setMenu(false);
    if (!window.confirm("Remove this listing from your deals?")) return;
    start(async () => {
      const r = await removeCheckedListingAction(listing.id);
      if ("error" in r) setMessage(r.error);
      else onRemoved(listing.id);
    });
  };

  const analyseHref = `/estimate?listing=${encodeURIComponent(listing.canonicalUrl)}`;
  const quick = listing.quick;
  const deal = listing.deal ?? quick?.deal ?? null;
  const est = quick?.estimate ?? null;
  const area = quick?.area ?? null;
  const comps = quick?.competitors ?? null;
  const p = areaRow?.personal ?? null;
  const costsPct = Math.round((DEFAULT_COSTS.platformPct + DEFAULT_COSTS.managementPct + DEFAULT_COSTS.cleaningPct) * 100);

  return (
    <aside className="mx-drawer mx-deal" aria-label={`${listing.title} verdict`}>
      <div className="mx-deal-head">
        <ListingThumb listing={listing} large />
        <div className="mx-deal-title">
          <h2>{listing.title}</h2>
          <div className="mx-deal-meta">
            {listing.listingStatus && listing.listingStatus !== "available" && <span className="mx-fit mx-fit--warn" style={{ marginRight: 6 }}>{LISTING_STATUS_LABEL[listing.listingStatus] ?? listing.listingStatus}</span>}
            {listingMeta(listing)}
          </div>
        </div>
        <button type="button" className="mx-cmp-close mx-deal-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="mx-status-seg" role="group" aria-label="Pipeline status">
        {PIPELINE_STATUSES.map((s) => (
          <button key={s.key} type="button" aria-pressed={listing.status === s.key} style={{ "--c": s.colour } as React.CSSProperties} onClick={() => setStatus(s.key)}>
            <i /> {s.label.replace(" booked", "").replace(" made", "")}
          </button>
        ))}
      </div>

      <div className="mx-drawer-body mx-deal-body">
        {message && <div className="mx-note mx-note--ok" role="status">{message}</div>}

        <VerdictBlock v={verdict} />
        <KeyTiles keys={verdict.keys} />
        {verdict.ceiling && <div className="mx-ceiling">{verdict.ceiling}</div>}

        <div className="mx-actions">
          <Link className="mx-btn mx-btn--primary" href={listing.analysedReportId ? `/reports/${listing.analysedReportId}` : analyseHref}>
            <FileText size={14} aria-hidden /> {listing.analysedReportId ? "Open full report" : <>Run full report <small>· uses 1 run</small></>}
          </Link>
          {areaRow && (
            <button type="button" className="mx-btn" onClick={() => onOpenArea(areaRow.card.code)}>
              {areaRow.card.name}{areaFit !== null ? ` · fit ${areaFit}` : areaRow.card.score ? ` · ${areaRow.card.score.score}` : ""}
            </button>
          )}
          <div className="mx-more" ref={menuRef}>
            <button type="button" className="mx-btn mx-btn--ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>More <ChevronDown size={14} aria-hidden /></button>
            {menu && (
              <div className="mx-menu" role="menu">
                <button type="button" role="menuitemcheckbox" aria-checked={comparing} disabled={!comparing && compareDisabled} onClick={() => { setMenu(false); onToggleCompare(); }}>{comparing ? "✓ Comparing" : "Compare"}</button>
                <button type="button" role="menuitem" onClick={share}>{listing.shareToken ? "Stop sharing" : "Share deal sheet"}</button>
                {listing.shareToken && <a role="menuitem" href={`/api/deal-pdf?token=${encodeURIComponent(listing.shareToken)}`} target="_blank" rel="noopener" onClick={() => setMenu(false)}>Download PDF</a>}
                {listing.analysedReportId && <Link role="menuitem" href={analyseHref} onClick={() => setMenu(false)}>Re-run full report</Link>}
                <a role="menuitem" href={listing.canonicalUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>Open on {SOURCE_LABELS[listing.source]}</a>
                <button type="button" role="menuitem" className="mx-menu-danger" onClick={remove}>Remove</button>
              </div>
            )}
          </div>
        </div>

        {sharePath && (
          <div className="mx-share">
            <span className="mx-eyebrow">Share link</span>
            <p>Anyone with this link sees the figures and deal maths, never your notes or details.</p>
            <div className="mx-share-row">
              <input className="mx-input" readOnly value={`${origin}${sharePath}`} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <button
                type="button"
                className="mx-pill mx-pill--sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`);
                    setMessage("Share link copied");
                  } catch {
                    setMessage("Copy the link from the box");
                  }
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        <div className="mx-working">
          <span className="mx-eyebrow">Show the working</span>

          <Working title="Where the estimate comes from" small={est ? SOURCE_LABEL[est.source] ?? est.source : "no estimate yet"}>
            {est ? (
              <>
                <p>{est.note}. {listing.kind === "str" ? "" : "A full report replaces this with live comparables for the exact postcode."}</p>
                {quick?.tracked && <p>The listing’s own figures are trailing 12 months from our data partner, refreshed monthly.</p>}
                {deal && (
                  <Kv
                    rows={
                      deal.kind === "purchase"
                        ? [
                            { k: "Running costs", v: `${costsPct}% of revenue + ${gbp(DEFAULT_COSTS.billsPcm)} bills a month` },
                            { k: "Mortgage", v: `${deal.depositPct}% deposit · ${deal.mortgageRatePct}% · ${deal.termYears} yrs` },
                            { k: "Stamp duty", v: gbp(deal.stampDuty) },
                            { k: "Setup budget", v: gbp(deal.setupCost) },
                            { k: "Net yield", v: `${deal.netYieldPct}%` },
                            { k: "Cash-on-cash", v: `${deal.cashOnCashPct}%` },
                          ]
                        : [
                            { k: "Running costs", v: `${costsPct}% of revenue + ${gbp(DEFAULT_COSTS.billsPcm)} bills a month` },
                            { k: "Monthly gross", v: gbp(deal.monthlyGross) },
                            { k: "Net before rent", v: gbp(deal.monthlyNetBeforeRent) },
                            { k: "Setup budget", v: gbp(deal.setupCost) },
                            { k: "Payback", v: deal.paybackMonths === null ? "never at this rent" : `${deal.paybackMonths} months` },
                          ]
                    }
                  />
                )}
                {quick?.pmiMarket?.revenueAnnual && <p className="mx-muted-p">Property Market Intel puts the area at {gbp(quick.pmiMarket.revenueAnnual)} a year{quick.pmiMarket.grade ? ` (grade ${quick.pmiMarket.grade})` : ""}.</p>}
              </>
            ) : (
              <p>We have no revenue figures for this postcode yet. The full report runs live comparables for the exact address.</p>
            )}
          </Working>

          <Working title="Month by month" small="needs the full report">
            <p>Seasonality, the underwater months and the cashflow chart come from the full report’s live comparables; the quick view works from the annual figure only.</p>
          </Working>

          <Working title="Competition nearby" small={comps ? `${comps.summary.count} tracked Airbnbs within 1 km` : "no tracked listings found"}>
            {comps ? (
              <>
                <Kv
                  rows={[
                    { k: "Tracked within 1 km", v: String(comps.summary.count) },
                    { k: `Same size (${listing.bedrooms ?? "?"} bed)`, v: String(comps.summary.sameSize) },
                    { k: "Median revenue", v: comps.summary.medianRevenue ? gbp(comps.summary.medianRevenue) : "—" },
                    { k: "Top quartile", v: comps.summary.topQuartileRevenue ? gbp(comps.summary.topQuartileRevenue) : "—" },
                    { k: "Median rate · occupancy", v: `${comps.summary.medianAdr ? gbp(comps.summary.medianAdr) : "—"} · ${comps.summary.medianOccupancy === null ? "—" : `${Math.round(comps.summary.medianOccupancy * 100)}%`}` },
                  ]}
                />
                <MiniMap listing={listing} />
              </>
            ) : (
              <p>No tracked short-lets within a kilometre in our partner’s data, or the lookup was skipped. The full report searches wider.</p>
            )}
          </Working>

          <Working title={areaRow ? `Area: ${areaRow.card.name}${areaRow.card.score ? ` ${areaRow.card.score.score} · ${areaRow.card.score.grade}` : ""}` : "Area"} small={(trendLabel(areaRow?.trend?.enquiries.direction) ?? area?.trend?.label)?.toLowerCase()}>
            {areaRow ? (
              <>
                <Kv
                  rows={[
                    { k: "Competition", v: areaRow.card.competition?.label ?? "—" },
                    { k: "Direct bookings", v: areaRow.card.directBooking?.label ?? "—" },
                    { k: "Enquiry trend", v: trendLabel(areaRow.trend?.enquiries.direction) ?? "—" },
                    ...(p?.fit.distanceMiles !== null && p?.fit.distanceMiles !== undefined ? [{ k: "Distance from home", v: `${p.fit.distanceMiles} mi` }] : []),
                    { k: "Licensing", v: areaRow.card.licensing.headline },
                    { k: "Data confidence", v: `${areaRow.card.confidence.label} · ${areaRow.card.headline.totalSamples} reports` },
                  ]}
                />
                <button type="button" className="mx-pill mx-pill--sm" style={{ marginTop: 10 }} onClick={() => onOpenArea(areaRow.card.code)}>Open {areaRow.card.name}</button>
              </>
            ) : (
              <p>{area ? `${area.name}: ${area.licensing.headline}.` : "No Market Explorer area data for this postcode yet."}</p>
            )}
          </Working>

          <Working title="Notes" small={listing.notes ? listing.notes.slice(0, 40) + (listing.notes.length > 40 ? "…" : "") : "nothing yet"} defaultOpen={Boolean(listing.notes)}>
            <textarea className="mx-input mx-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Viewing date, agent name, what you would offer…" aria-label="Notes" />
          </Working>
        </div>

        <p className="mx-src-line">
          Figures are estimates from Stayful and its data partners; the full report runs live comparables for this property. <a href={listing.canonicalUrl} target="_blank" rel="noopener noreferrer">View the listing on {SOURCE_LABELS[listing.source]} <ExternalLink size={11} aria-hidden /></a>
        </p>
      </div>
    </aside>
  );
}
