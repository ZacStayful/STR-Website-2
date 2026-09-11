"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ExternalLink, FileText, Link2, Share2, Trash2, X } from "lucide-react";
import { removeCheckedListingAction, shareListingAction, unshareListingAction, updateListingNotesAction, updateListingStatusAction } from "../../actions";
import { SourceListingCard } from "@/app/estimate/_components/SourceListingCard";
import { PIPELINE_STATUSES, type CheckedListingRow, type PipelineStatus } from "@/lib/listing/pipeline";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import type { ListingSnapshot } from "@/lib/listing/types";
import type { ExplorerRow } from "./types";

function snapshotFromRow(l: CheckedListingRow): ListingSnapshot {
  return {
    source: l.source,
    id: l.canonicalUrl,
    canonicalUrl: l.canonicalUrl,
    fetchedAt: l.updatedAt,
    parserVersion: 0,
    kind: l.kind,
    title: l.title,
    displayAddress: l.displayAddress ?? undefined,
    postcode: l.postcode ?? undefined,
    lat: l.lat ?? undefined,
    lng: l.lng ?? undefined,
    bedrooms: l.bedrooms ?? undefined,
    price: l.price ? ({ amount: l.price.amount, period: l.price.period } as ListingSnapshot["price"]) : undefined,
    status: l.listingStatus ?? undefined,
    features: [],
    photos: l.photo ? [l.photo] : [],
    locationConfidence: l.postcode ? "exact" : "none",
  };
}

export function ListingDrawer({
  listing,
  areaRow,
  comparing,
  compareDisabled,
  onClose,
  onChange,
  onRemoved,
  onOpenArea,
  onToggleCompare,
}: {
  listing: CheckedListingRow;
  areaRow: ExplorerRow | null;
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
  const [, start] = useTransition();
  const status = PIPELINE_STATUSES.find((s) => s.key === listing.status)!;
  // Rendered as a path so server and client markup match; the copy button adds the origin.
  const sharePath = listing.shareToken ? `/deal/${listing.shareToken}` : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- origin is only known in the browser; SSR renders the path
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    if (!window.confirm("Remove this listing from your pipeline?")) return;
    start(async () => {
      const r = await removeCheckedListingAction(listing.id);
      if ("error" in r) setMessage(r.error);
      else onRemoved(listing.id);
    });
  };

  const analyseHref = `/estimate?listing=${encodeURIComponent(listing.canonicalUrl)}`;

  return (
    <aside className="mx-drawer" aria-label={`${listing.title} details`}>
      <div className="mx-drawer-head">
        <div className="mx-drawer-title">
          <div className="mx-breadcrumb">{SOURCE_LABELS[listing.source]} listing{listing.postcodeArea ? ` · ${listing.postcodeArea} area` : ""}</div>
          <h2 style={{ fontSize: "1.2rem" }}>{listing.title}</h2>
          <div className="mx-card-badges">
            <select className="mx-select mx-select--status" aria-label="Pipeline status" value={listing.status} onChange={(e) => setStatus(e.target.value as PipelineStatus)} style={{ borderColor: status.colour }}>
              {PIPELINE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {areaRow?.card.managedByStayful && <span className="mx-managed">Stayful manages here</span>}
          </div>
        </div>
        <button type="button" className="mx-cmp-close mx-drawer-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="mx-drawer-actions">
        <Link className="mx-pill mx-pill--sm on" href={listing.analysedReportId ? `/reports/${listing.analysedReportId}` : analyseHref}>
          <FileText size={13} /> {listing.analysedReportId ? "Open full report" : "Run full analysis"}
        </Link>
        {listing.analysedReportId && <Link className="mx-pill mx-pill--sm" href={analyseHref}>Re-run</Link>}
        {areaRow && <button type="button" className="mx-pill mx-pill--sm" onClick={() => onOpenArea(areaRow.card.code)}>Area: {areaRow.card.name}</button>}
        <button type="button" className={"mx-pill mx-pill--sm" + (comparing ? " on" : "")} aria-pressed={comparing} disabled={!comparing && compareDisabled} onClick={onToggleCompare}>{comparing ? "✓ Comparing" : "+ Compare"}</button>
        <button type="button" className={"mx-pill mx-pill--sm" + (listing.shareToken ? " on" : "")} onClick={share}><Share2 size={13} /> {listing.shareToken ? "Sharing on" : "Share deal sheet"}</button>
        {listing.shareToken && <a className="mx-pill mx-pill--sm" href={`/api/deal-pdf?token=${encodeURIComponent(listing.shareToken)}`} target="_blank" rel="noopener">PDF</a>}
        <button type="button" className="mx-pill mx-pill--sm" onClick={remove}><Trash2 size={13} /> Remove</button>
      </div>

      <div className="mx-drawer-body">
        {message && <div className="mx-note mx-note--ok" role="status">{message}</div>}
        <SourceListingCard snapshot={snapshotFromRow(listing)} quick={listing.quick ? { ...listing.quick, deal: listing.quick.deal ?? listing.deal } : null} />

        {sharePath && (
          <div className="mx-panel mx-panel--tight">
            <h2><Link2 size={14} /> Share link</h2>
            <p style={{ color: "var(--mx-muted)" }}>Anyone with this link sees the figures and deal maths, never your notes or details.</p>
            <div style={{ display: "flex", gap: 6 }}>
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

        <div className="mx-panel mx-panel--tight">
          <h2>Notes</h2>
          <textarea className="mx-input mx-textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Viewing date, agent name, what you would offer…" aria-label="Notes" />
        </div>

        <p className="mx-disclaimer">
          <a href={listing.canonicalUrl} target="_blank" rel="noopener noreferrer">View the listing on {SOURCE_LABELS[listing.source]} <ExternalLink size={11} aria-hidden /></a>. Figures are estimates from Stayful and its data partners; the full report runs live comparables for this property.
        </p>
      </div>
    </aside>
  );
}
