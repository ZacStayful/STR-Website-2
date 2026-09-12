"use client";

import { useState } from "react";
import { Icon } from "@/lib/icons";

const FAQS = [
  {
    q: "Where does the data come from?",
    a: "Every figure is aggregated from real Stayful analyser reports — live short-let comparables, long-let valuations, local demand drivers and events — grouped by UK postcode area and bedroom count. Areas are tiered by how many reports back them, so you always know how solid a number is.",
  },
  {
    q: "Is the score a black box like other tools?",
    a: "No. The Stayful score is a transparent 0–100 composite of four named factors (yield-on-cost 40, occupancy 25, revenue scale 20, regulatory ease 15). Every area shows the raw value behind each factor and the points it earned.",
  },
  {
    q: "What does 'tailored to my goals' actually change?",
    a: "Your goal profile — location, distance, budget, bedrooms, priorities, management style and risk appetite — produces a personal 'fit' score shown beside the Stayful score, and re-orders the list when you sort by it. The Stayful score itself never changes, so you can always compare like for like.",
  },
  {
    q: "Do I get it on the free trial?",
    a: "Yes. The Market Explorer is included from the moment you sign up, alongside £20 of free credit. Browsing the explorer is free; only paid lookups such as listing checks use credit.",
  },
  {
    q: "Can I check a specific property I've found online?",
    a: "Yes. Paste a Rightmove, OnTheMarket or Airbnb link anywhere in Stayful and we fill in the details, show a free quick view (estimated revenue, area score, competition and what a tracked Airbnb actually earns), and run the deal maths on the asking price or rent. Zoopla and Booking.com are read by the Stayful browser extension, which also puts the quick view on every listing page you open. The full report still uses one of your runs.",
  },
  {
    q: "How is this different from the property analyser?",
    a: "The analyser answers 'what would this specific address earn?'. The Market Explorer answers 'where should I be looking in the first place?'. Use the explorer to pick an area, then run the analyser on the properties you find there.",
  },
];

export function ProductFaq() {
  const [open, setOpen] = useState<number>(0);
  return (
    <section className="faq section" id="faq">
      <div className="wrap-narrow">
        <div className="faq-head">
          <div className="eyebrow">Common questions</div>
          <h2>Straight answers.</h2>
        </div>
        <div className="faq-list">
          {FAQS.map((f, i) => (
            <div key={f.q} className={"faq-row" + (open === i ? " open" : "")}>
              <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{f.q}</span>
                <span className="faq-toggle">{open === i ? <Icon name="minus" size={14} /> : <Icon name="plus" size={14} />}</span>
              </button>
              <div className="faq-a-wrap">
                <p className="faq-a">{f.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
