"use client";

import type { ReactNode } from "react";
import { formatTrackValue, type Verdict, type VerdictKey, type VerdictTone, type VerdictTrack } from "@/lib/listing/verdict";

/** Small coloured chip: Works / Tight / Doesn’t work / Benchmark. */
export function VerdictChip({ tone, label }: { tone: VerdictTone; label: string }) {
  return <span className={`mx-vchip mx-vchip--${tone}`}>{label}</span>;
}

/** Conic ring showing a 0–100 fit. */
export function FitRing({ value, label = "fit" }: { value: number; label?: string }) {
  return (
    <div className="mx-fitring" style={{ "--v": value } as React.CSSProperties} title={`Your fit ${value}/100`}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function Track({ t }: { t: VerdictTrack }) {
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - t.min) / (t.max - t.min)) * 100));
  return (
    <div className="mx-track" role="img" aria-label={`${formatTrackValue(t.me, t.unit)} against ${t.targetLabel}`}>
      <div className="mx-track-bar">
        <div className="mx-track-fill" style={{ width: `${pos(t.me)}%` }} />
        <div className="mx-track-target" style={{ left: `${pos(t.target)}%` }} data-l={t.targetLabel} />
        <div className="mx-track-me" style={{ left: `${pos(t.me)}%` }} data-l={formatTrackValue(t.me, t.unit)} />
      </div>
      <div className="mx-track-axis"><span>{formatTrackValue(t.min, t.unit)}</span><span>{formatTrackValue(t.max, t.unit)}</span></div>
    </div>
  );
}

/** The headline block: eyebrow, one-line answer, one sentence, the target bar. */
export function VerdictBlock({ v, eyebrow }: { v: Verdict; eyebrow?: string }) {
  return (
    <div className={`mx-verdict-block mx-verdict-block--${v.tone}`}>
      <span className="mx-eyebrow mx-verdict-eyebrow">{eyebrow ?? v.chip}</span>
      <h3>{v.headline}</h3>
      <p>{v.sentence}</p>
      {v.track && <Track t={v.track} />}
    </div>
  );
}

export function KeyTiles({ keys }: { keys: VerdictKey[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="mx-keys">
      {keys.map((k) => (
        <div key={k.label} className="mx-key">
          <div className="mx-key-k">{k.label}</div>
          <div className={"mx-key-v" + (k.tone ? ` mx-key-v--${k.tone}` : "")}>{k.value}</div>
          <div className="mx-key-s">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** One fold of "Show the working". */
export function Working({ title, small, defaultOpen = false, children }: { title: string; small?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="mx-w" open={defaultOpen || undefined}>
      <summary>
        <span>{title}{small && <small>{small}</small>}</span>
      </summary>
      <div className="mx-w-in">{children}</div>
    </details>
  );
}

/** Label / value pairs inside a fold. */
export function Kv({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="mx-kv">
      {rows.map((r) => (
        <div key={r.k} className="mx-kv-row"><dt>{r.k}</dt><dd>{r.v}</dd></div>
      ))}
    </dl>
  );
}
