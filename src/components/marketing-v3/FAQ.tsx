"use client";

import { useState } from "react";
import { Icon } from "@/lib/icons";
import { FAQS, type FAQItem } from "@/lib/faqs-data";

export function FAQ({
  items = FAQS,
  eyebrow = "Common questions",
  heading = "Answers, not pitches.",
}: {
  items?: FAQItem[];
  eyebrow?: string;
  heading?: string;
}) {
  const [open, setOpen] = useState<number>(0);
  return (
    <section className="faq section" id="faq">
      <div className="wrap-narrow">
        <div className="faq-head">
          <div className="eyebrow">{eyebrow}</div>
          <h2>{heading}</h2>
        </div>
        <div className="faq-list">
          {items.map((f, i) => (
            <div key={i} className={"faq-row" + (open === i ? " open" : "")}>
              <button
                className="faq-q"
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                <span>{f.q}</span>
                <span className="faq-toggle">
                  {open === i ? (
                    <Icon name="minus" size={14} />
                  ) : (
                    <Icon name="plus" size={14} />
                  )}
                </span>
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
