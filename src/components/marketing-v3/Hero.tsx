"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { DemoFrame, type DemoStage } from "./DemoFrame";

const LOADING_STEPS = [
  "Locating property",
  "Fetching short-let data",
  "Fetching long-let valuation",
  "Finding nearby amenities",
  "Discovering local events",
  "Running analysis",
];

export function Hero() {
  const [postcode, setPostcode] = useState("");
  const [stage, setStage] = useState<DemoStage>("idle");
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (stage !== "loading") return;
    setProgress(0);
    setStepIndex(0);
    let p = 0;
    const t = setInterval(() => {
      p += 4;
      const capped = Math.min(p, 100);
      setProgress(capped);
      const idx = Math.min(
        LOADING_STEPS.length - 1,
        Math.floor(capped / (100 / LOADING_STEPS.length))
      );
      setStepIndex(idx);
      if (p >= 100) {
        clearInterval(t);
        setTimeout(() => setStage("result"), 350);
      }
    }, 90);
    return () => clearInterval(t);
  }, [stage]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = "/signup";
  };

  const reset = () => {
    setStage("idle");
    setProgress(0);
    setStepIndex(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <section className="hero">
      <div className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="dot" /> The Stayful Property Analyser
          </span>
          <h1>
            Every short-let decision,{" "}
            <span className="hero-script">answered.</span>
          </h1>
          <p className="lede">
            A decision engine for short-term rental — not a revenue calculator.
            Type a postcode and get an 11-section report on what your property
            could earn, how the market actually behaves and what you&rsquo;d
            need to do to win in it.
          </p>

          <form className="postcode-form" onSubmit={submit}>
            <label className="postcode-label">
              <Icon name="pin" size={18} color="var(--sage-500)" />
              <input
                ref={inputRef}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                placeholder="Enter a UK postcode  e.g. YO31 7NU"
                spellCheck={false}
                disabled={stage !== "idle"}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={stage !== "idle"}
            >
              {stage === "idle"
                ? "Run free analysis"
                : stage === "loading"
                  ? "Analysing…"
                  : "Done"}{" "}
              <Icon name="arrow" size={16} />
            </button>
          </form>

          <div className="hero-meta row gap-24" style={{ flexWrap: "wrap" }}>
            <span>
              <Icon name="check" size={14} color="var(--sage-500)" /> Free trial
            </span>
            <span>
              <Icon name="check" size={14} color="var(--sage-500)" /> No card
              required
            </span>
            <span>
              <Icon name="check" size={14} color="var(--sage-500)" /> 10–20s per
              report
            </span>
          </div>
        </div>

        <div className="hero-demo">
          <DemoFrame
            stage={stage}
            progress={progress}
            stepIndex={stepIndex}
            postcode={postcode || "YO31 7NU"}
            onReset={reset}
            loadingSteps={LOADING_STEPS}
          />
        </div>
      </div>
    </section>
  );
}
