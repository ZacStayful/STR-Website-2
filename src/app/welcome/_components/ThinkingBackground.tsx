"use client";

import { useEffect, useRef } from "react";
import { NEURONS, neuronAt, neuronCount, readThinking, subscribeThinking, type ThinkingSignal } from "@/lib/intelligence/thinking-signal";

/**
 * Batch 22, Part D2: the neuron network behind the quiz card. One canvas,
 * fixed behind the page, never taking a tap, scroll or key. It grows only with
 * real answers (thinking-signal.ts), fires a burst on each one and a wave on
 * each level reached, in the brand colour (--primary) at low opacity. Nothing
 * is drawn behind the question card (its rectangle plus 24px, fading out at
 * the edge). Paused while the tab is hidden; reduced motion gets one still
 * drawing. No global CSS, no library.
 */
const CARD_MARGIN = 24;
const FADE = 32;

interface Pulse {
  from: number;
  to: number;
  start: number;
  ms: number;
}

export default function ThinkingBackground({ strength = 1 }: { strength?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let colour = "#5d8156";
    const readColour = () => {
      const c = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      if (c) colour = c;
    };
    readColour();

    let w = 0;
    let h = 0;
    let phone = false;
    let card: DOMRect | null = null;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      phone = w < 640;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      measureCard();
      links = null;
    };
    const cardEl = () => document.querySelector("[data-quiz-card]");
    const measureCard = () => {
      const el = cardEl();
      card = el ? el.getBoundingClientRect() : null;
    };

    let signal: ThinkingSignal = readThinking();
    let seen = { answer: signal.answerSeq, level: signal.levelUpSeq };
    let links: [number, number][] | null = null;
    let linkCount = -1;
    const pulses: Pulse[] = [];
    let wave: { start: number } | null = null;
    let lastPulse = 0;

    const points = (n: number) => Array.from({ length: n }, (_, i) => neuronAt(i)).map((p) => ({ x: p.x * w, y: p.y * h }));

    const buildLinks = (pts: { x: number; y: number }[], k: number) => {
      const out: [number, number][] = [];
      for (let i = 0; i < pts.length; i++) {
        const near = pts
          .map((p, j) => ({ j, d: (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2 }))
          .filter((x) => x.j !== i)
          .sort((a, b) => a.d - b.d)
          .slice(0, k);
        for (const n of near) if (!out.some(([a, b]) => (a === n.j && b === i) || (a === i && b === n.j))) out.push([i, n.j]);
      }
      return out;
    };

    // How visible a point is: 0 inside the card's zone, fading in over FADE px.
    const visibility = (x: number, y: number) => {
      if (!card) return 1;
      const dx = Math.max(card.left - CARD_MARGIN - x, 0, x - (card.right + CARD_MARGIN));
      const dy = Math.max(card.top - CARD_MARGIN - y, 0, y - (card.bottom + CARD_MARGIN));
      const d = Math.max(dx, dy);
      if (dx === 0 && dy === 0) return 0;
      return Math.min(1, d / FADE);
    };

    const draw = (now: number) => {
      const n = neuronCount(signal, phone);
      const spec = NEURONS[signal.level];
      const pts = points(n);
      if (!links || linkCount !== n) {
        links = buildLinks(pts, spec.links);
        linkCount = n;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      const base = spec.opacity * strength;
      const waveAt = wave ? (now - wave.start) / 900 : -1;
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        const p = pts[a];
        const q = pts[b];
        const v = Math.min(visibility(p.x, p.y), visibility(q.x, q.y));
        if (v <= 0) continue;
        ctx.globalAlpha = base * 0.6 * v;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      for (const p of pts) {
        const v = visibility(p.x, p.y);
        if (v <= 0) continue;
        let a = base;
        if (waveAt >= 0 && waveAt <= 1) {
          const front = waveAt * (w + h);
          const dist = Math.abs(p.x + p.y - front);
          if (dist < 80) a = Math.max(a, 0.6 * strength * (1 - dist / 80));
        }
        ctx.globalAlpha = a * v;
        ctx.beginPath();
        ctx.arc(p.x, p.y, phone ? 1.6 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pu = pulses[i];
        const t = (now - pu.start) / pu.ms;
        if (t >= 1 || !pts[pu.from] || !pts[pu.to]) {
          pulses.splice(i, 1);
          continue;
        }
        const x = pts[pu.from].x + (pts[pu.to].x - pts[pu.from].x) * t;
        const y = pts[pu.from].y + (pts[pu.to].y - pts[pu.from].y) * t;
        const v = visibility(x, y);
        if (v <= 0) continue;
        ctx.globalAlpha = 0.6 * strength * v;
        ctx.beginPath();
        ctx.arc(x, y, phone ? 2 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (wave && waveAt > 1) wave = null;
      return { pts, spec };
    };

    // A burst: pulses from the neurons nearest the card's edges.
    const burst = (now: number, pts: { x: number; y: number }[]) => {
      if (!links || links.length === 0) return;
      const cx = card ? (card.left + card.right) / 2 : w / 2;
      const cy = card ? (card.top + card.bottom) / 2 : h / 2;
      const order = pts.map((p, i) => ({ i, d: Math.abs(p.x - cx) + Math.abs(p.y - cy) })).sort((a, b) => a.d - b.d);
      const from = new Set(order.slice(0, 6).map((x) => x.i));
      for (const [a, b] of links) if (from.has(a) || from.has(b)) pulses.push({ from: from.has(a) ? a : b, to: from.has(a) ? b : a, start: now, ms: 700 });
    };

    let raf = 0;
    let running = false;
    const frame = (now: number) => {
      const { pts, spec } = draw(now);
      if (signal.answerSeq !== seen.answer) {
        seen = { ...seen, answer: signal.answerSeq };
        burst(now, pts);
      }
      if (signal.levelUpSeq !== seen.level) {
        seen = { ...seen, level: signal.levelUpSeq };
        wave = { start: now };
      }
      if (links && links.length > 0 && now - lastPulse > spec.pulseMs) {
        lastPulse = now;
        const [a, b] = links[Math.floor(Math.random() * links.length)];
        pulses.push({ from: a, to: b, start: now, ms: 1200 });
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduced || running || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    if (reduced) draw(performance.now());
    else start();

    const unsubscribe = subscribeThinking(() => {
      signal = readThinking();
      if (reduced) draw(performance.now());
    });
    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => {
      resize();
      if (reduced) draw(performance.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", measureCard, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureCard) : null;
    const el = cardEl();
    if (ro && el) ro.observe(el);
    const themeWatch = new MutationObserver(() => {
      readColour();
      if (reduced) draw(performance.now());
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => readColour();
    mq.addEventListener?.("change", onScheme);

    return () => {
      stop();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", measureCard);
      ro?.disconnect();
      themeWatch.disconnect();
      mq.removeEventListener?.("change", onScheme);
    };
  }, [strength]);

  return <canvas ref={ref} aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }} />;
}
