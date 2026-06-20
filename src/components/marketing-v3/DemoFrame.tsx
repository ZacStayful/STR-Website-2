"use client";

import { Icon } from "@/lib/icons";

export type DemoStage = "idle" | "loading" | "result";

interface DemoFrameProps {
  stage: DemoStage;
  progress: number;
  stepIndex: number;
  postcode: string;
  onReset: () => void;
  loadingSteps: string[];
}

export function DemoFrame({
  stage,
  progress,
  stepIndex,
  postcode,
  onReset,
  loadingSteps,
}: DemoFrameProps) {
  return (
    <div className="demo-frame">
      <div className="demo-chrome">
        <div className="demo-dots">
          <span /> <span /> <span />
        </div>
        <div className="demo-url">stayful.co.uk/analyse</div>
        <div className="demo-actions">
          {stage === "result" && (
            <button className="demo-reset" onClick={onReset}>
              <Icon name="search" size={12} /> New search
            </button>
          )}
        </div>
      </div>
      <div className="demo-body">
        {stage === "idle" && <DemoIdle />}
        {stage === "loading" && (
          <DemoLoading
            progress={progress}
            stepIndex={stepIndex}
            postcode={postcode}
            loadingSteps={loadingSteps}
          />
        )}
        {stage === "result" && <DemoResult postcode={postcode} />}
      </div>
    </div>
  );
}

function DemoIdle() {
  return (
    <div className="demo-idle">
      <div className="demo-form-card">
        <div
          className="demo-form-title row gap-8 center"
          style={{ justifyContent: "flex-start" }}
        >
          <Icon name="search" size={16} color="var(--sage-600)" />
          <span>Analyse Your Property</span>
        </div>
        <div className="demo-input-pill">
          <Icon name="check" size={14} color="var(--sage-600)" />
          <span>17 Park Crescent, York</span>
          <span className="demo-pill-action">Change</span>
        </div>
        <div className="demo-form-row">
          <div className="demo-field">
            <label>
              <Icon name="overview" size={12} /> Property Type
            </label>
            <div className="demo-select">
              Terraced <Icon name="chevron" size={12} />
            </div>
          </div>
          <div className="demo-field">
            <label>
              <Icon name="bed" size={12} /> Bedrooms
            </label>
            <div className="demo-select">3</div>
          </div>
        </div>
        <div className="demo-form-row">
          <div className="demo-field">
            <label>
              <Icon name="users" size={12} /> Max Guests
            </label>
            <div className="demo-select">8</div>
          </div>
          <div className="demo-field">
            <label>
              <Icon name="bath" size={12} /> Bathrooms
            </label>
            <div className="demo-select">2</div>
          </div>
        </div>
        <div className="demo-cta">
          Click <strong>Run free analysis</strong> to see this property&rsquo;s
          full report
        </div>
      </div>
    </div>
  );
}

interface DemoLoadingProps {
  progress: number;
  stepIndex: number;
  postcode: string;
  loadingSteps: string[];
}

function DemoLoading({
  progress,
  stepIndex,
  postcode,
  loadingSteps,
}: DemoLoadingProps) {
  return (
    <div className="demo-loading">
      <div className="demo-brand-mark">
        <span className="brand-mark" style={{ fontSize: 28 }}>
          Stayful
        </span>
      </div>
      <div className="demo-loading-title">
        <Icon name="loading" size={18} color="var(--sage-600)" />
        Analysing {postcode}…
      </div>
      <div className="demo-progress-row">
        <span>Property located</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="demo-progress-bar">
        <div
          className="demo-progress-fill"
          style={{ width: progress + "%" }}
        />
      </div>
      <div className="demo-steps">
        {loadingSteps.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div
              key={step}
              className={
                "demo-step " + (done ? "done" : active ? "active" : "")
              }
            >
              <span className="demo-step-circle">
                {done ? <Icon name="check" size={11} stroke={2.5} /> : null}
              </span>
              <span
                className={"demo-step-label" + (done ? " strike" : "")}
              >
                {step}…
              </span>
            </div>
          );
        })}
      </div>
      <div className="demo-loading-foot">
        Gathering data from Airbtics, PropertyData, Google Places, and
        Ticketmaster.
        <br />
        This usually takes 10–20 seconds.
      </div>
    </div>
  );
}

function DemoResult({ postcode }: { postcode: string }) {
  return (
    <div className="demo-result">
      <div className="demo-result-head">
        <div className="demo-status">
          <Icon name="check" size={14} stroke={2.5} /> Analysis Complete
        </div>
        <div className="demo-pdf">
          <Icon name="download" size={13} /> Download as PDF
        </div>
      </div>
      <div className="demo-result-title">
        <h3>17 Park Crescent, York</h3>
        <p className="demo-result-sub">3 bed · 2 bath · Sleeps 8 · {postcode}</p>
      </div>
      <div className="demo-result-grid">
        <div className="demo-stat-block">
          <div className="demo-stat-label">Top market potential</div>
          <div className="demo-stat-sub">
            What a top-performer in this area earns
          </div>
          <div className="demo-stat-num">
            £59,508 <span>£4,959/mo</span>
          </div>
        </div>
        <div className="demo-stat-block">
          <div className="demo-stat-label">Your filtered estimate</div>
          <div className="demo-stat-sub">Average of comps you kept</div>
          <div className="demo-stat-num">
            £42,180 <span>£3,515/mo</span>
          </div>
        </div>
        <div className="demo-stat-block sub">
          <div className="demo-stat-label">Net revenue</div>
          <div className="demo-stat-num small">
            £30,940 <span>£2,578/mo</span>
          </div>
          <div className="demo-stat-foot">
            After platform fees, cleaning, laundry &amp; management
          </div>
        </div>
        <div className="demo-stat-block sub">
          <div className="demo-stat-label">ADR · Occupancy</div>
          <div className="demo-stat-num small">
            £207 <span>· 78%</span>
          </div>
          <div className="demo-stat-foot">vs 55% UK market average</div>
        </div>
      </div>
      <div className="demo-result-foot">
        <Icon name="chevron" size={12} /> 10 more sections: Comparables,
        Amenities, Forecast, Local Area, Risk, Growth…
      </div>
    </div>
  );
}
