export interface Faq {
  q: string;
  a: string;
}

// Tailored to a landlord reading their own intelligence report.
export const FAQS: Faq[] = [
  {
    q: "How accurate are these income figures?",
    a: "They're modelled on what comparable short lets in your area actually achieve across a full year — including the quiet months — not a best-case projection. Treat the net figure as a realistic mid-point you could defend to a lender, with the demand chart showing how it moves season to season.",
  },
  {
    q: "What does the management fee cover — and can I remove it?",
    a: "The 15% + VAT management fee covers guest communication, dynamic pricing, cleaning coordination, listing optimisation and 24/7 support. If you plan to self-manage, tick the toggle in the income section to see your numbers without it — though most owners find professional management more than pays for itself in higher occupancy and ADR.",
  },
  {
    q: "What if my occupancy is lower than estimated?",
    a: "The figures already use a realistic annual average, and the risk profile flags seasonality so you can plan for it. A two-month void buffer and dynamic pricing protect you through the slower Jan–Feb period.",
  },
  {
    q: "Do I need a licence or planning permission to short let?",
    a: "It depends on your council. Most areas have no restriction, but some operate Article 4 directions or licensing schemes. The risk profile tracks local regulation as a factor to watch — always confirm the current position with your local authority before committing.",
  },
  {
    q: "How much is setup, and when do I get it back?",
    a: "Furnishing and setup is a one-off cost shown in the STR vs long let section, sized to your bedroom count. The payback figure tells you how many months of uplift over long letting it takes to recover — typically well within the first year.",
  },
  {
    q: "Can Stayful manage this property for me?",
    a: "Yes. Stayful runs 70+ UK short-term lets end-to-end at 15% + VAT. If this report shows your property is worth short letting, book a call and we'll talk through how we'd run it for you.",
  },
];
