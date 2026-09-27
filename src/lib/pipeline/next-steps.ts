// ═══════════════════════════════════════════════════════════════════════════
//  NEXT STEPS: what a member sees under each deal on My deals and on the
//  deal page, stage by stage.
// ═══════════════════════════════════════════════════════════════════════════
//
//  HOW TO EDIT THIS FILE
//
//  • Change the words between the backticks ` `. Leave everything else as it
//    is: the names before the colons, the commas and the brackets { }.
//  • Every stage has a PURCHASE version (buying the property) and a
//    RENT-TO-RENT version (renting it to run as a short let).
//  • Keep to plain UK English, short sentences, no exclamation marks. Never
//    promise an outcome to the member and never give financial advice. The
//    tests will fail if a "!" or words like "guarantee" appear where they
//    should not.
//
//  MERGE FIELDS: the deal's own details, written in {curly brackets}.
//
//    {address}       the property's address
//    {town}          the town
//    {bedrooms}      "2-bedroom", or "studio"
//    {askingPrice}   "£185,000" (purchase only)
//    {askingRent}    "£1,100 a month" (rent-to-rent only)
//    {timeOnMarket}  "7 months", "5 weeks", or "at least 7 months"
//    {memberName}    the member's own name
//    {offerAmount}   the offer the member types in (offer messages only)
//
//  Any of these can be missing on a given deal. So in a message, ALWAYS put a
//  field inside [square brackets] together with the words that go with it:
//
//      I'd like to view the property[ at {address}].
//
//  Anything inside [ ] only appears when every field inside it is known.
//  Without the address, that line reads "I'd like to view the property."
//  Keep each [ ] on one line, and never put one [ ] inside another.
//
//  The offer range lines further down use their own fields ({targetYield},
//  {targetCeiling}, {opening} and so on). The code only shows those lines
//  when their figures exist, so they don't need brackets.
//
//  CHECKLISTS: each item has an id (like 'parking') that saves the tick.
//  Change the words freely, but don't change an id once it is live, or the
//  ticks saved under it disappear. A new item needs a new, unique id in
//  lower case with dashes.
//
//  Every piece marked "DRAFT — Zac to rewrite" is a first draft.
// ═══════════════════════════════════════════════════════════════════════════

import type { NextStepsContent } from './types.ts';

export const NEXT_STEPS = {
  stages: {
    // ─────────────────────────────────────────────────────────────────────
    //  KEPT: the member has kept the deal and opened it.
    //  Next step: contact the agent.
    // ─────────────────────────────────────────────────────────────────────
    kept: {
      purchase: {
        // DRAFT — Zac to rewrite
        heading: `Contact the agent`,
        // DRAFT — Zac to rewrite
        intro: `Ask for a viewing, and get the answers that decide whether it can work as a short let before you go.`,
        message: {
          id: 'kept-purchase-enquiry',
          // DRAFT — Zac to rewrite
          subject: `Viewing request[: {address}]`,
          // DRAFT — Zac to rewrite
          body: `
Hello,

I'm interested in the [{bedrooms} ]property[ at {address}][, listed at {askingPrice}], and I'd like to arrange a viewing.

Before I view, could you tell me:
- Is it freehold or leasehold? If leasehold, how many years are left on the lease?
- Does the lease or title have any clause on short lets or subletting?
- What are the service charge and ground rent?
- Why is the seller moving, and are they in a chain?

What times do you have for a viewing?

Thanks,
[{memberName}]
`,
        },
      },
      rentToRent: {
        // DRAFT — Zac to rewrite
        heading: `Contact the agent`,
        // DRAFT — Zac to rewrite
        intro: `Propose a company let. Be clear from the start that it would run as serviced accommodation and needs the landlord's written consent.`,
        message: {
          id: 'kept-r2r-company-let',
          // DRAFT — Zac to rewrite
          subject: `Company let enquiry[: {address}]`,
          // DRAFT — Zac to rewrite (based on Zac's pitch)
          body: `
Hello,

I'm getting in touch about the [{bedrooms} ]property[ at {address}][, advertised at {askingRent}].

We're looking to take the property on a company let agreement, normally for three to five years. We're actively looking for several properties in[ {town} and] the surrounding area to house our clients: professionals, hospital workers and contractors.

To be clear from the start, we would run the property as serviced accommodation for those guests. That needs the landlord's written consent, which we would put in the agreement.

The rent is guaranteed for the full term: paid every month under the company let, whether or not the property is occupied, so there are no void periods. We're also open to working with the landlord on certain maintenance issues.

Would the landlord be open to this? If so, could we arrange a viewing?

Thanks,
[{memberName}]
`,
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    //  CONTACTED: the member has sent the first message.
    //  Next step: book a viewing.
    // ─────────────────────────────────────────────────────────────────────
    contacted: {
      purchase: {
        // DRAFT — Zac to rewrite
        heading: `Book a viewing`,
        // DRAFT — Zac to rewrite
        intro: `If the agent hasn't replied after a few days, send a short follow-up.`,
        message: {
          id: 'contacted-purchase-follow-up',
          // DRAFT — Zac to rewrite
          subject: `Following up: viewing request[ for {address}]`,
          // DRAFT — Zac to rewrite
          body: `
Hello,

I got in touch recently about the property[ at {address}] and wanted to follow up. I'm still keen to arrange a viewing.

Could you let me know some times that work, and whether the seller has had any offers so far?

Thanks,
[{memberName}]
`,
        },
      },
      rentToRent: {
        // DRAFT — Zac to rewrite
        heading: `Book a viewing`,
        // DRAFT — Zac to rewrite
        intro: `If the agent or landlord hasn't replied after a few days, send a short follow-up.`,
        message: {
          id: 'contacted-r2r-follow-up',
          // DRAFT — Zac to rewrite
          subject: `Following up: company let enquiry[ for {address}]`,
          // DRAFT — Zac to rewrite
          body: `
Hello,

I got in touch recently about the property[ at {address}] and wanted to follow up. We're still keen to take it on a company let for three to five years, run as serviced accommodation with the landlord's written consent.

Has the landlord had a chance to consider it? If they're open to it, we'd like to arrange a viewing.

Thanks,
[{memberName}]
`,
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    //  VIEWING: a viewing is booked.
    //  Next step: check it works as a short let. A checklist to tick.
    // ─────────────────────────────────────────────────────────────────────
    viewing: {
      purchase: {
        // DRAFT — Zac to rewrite
        heading: `Check it works as a short let`,
        // DRAFT — Zac to rewrite
        intro: `Take this list to the viewing. Tick each one off as you check it.`,
        // DRAFT — Zac to rewrite (the words; keep the ids)
        checklist: [
          { id: 'parking', text: `Parking: is there space for guests, and is it allocated or on the street?` },
          { id: 'access', text: `Access and self check-in: could guests let themselves in with a key safe or smart lock?` },
          { id: 'rules', text: `Building rules and lease clauses: is there anything that limits short lets?` },
          { id: 'neighbours', text: `Noise and neighbours: how close are they, and how would guests affect them?` },
          { id: 'fire-safety', text: `Fire safety: smoke alarms, fire doors and a clear way out.` },
          { id: 'kitchen-bathrooms', text: `Kitchen and bathrooms: their condition, and what needs doing before guests arrive.` },
          { id: 'broadband', text: `Broadband: the speeds available at the address.` },
          { id: 'furnishing', text: `Furnishing: what's included and what you would need to buy.` },
        ],
      },
      rentToRent: {
        // DRAFT — Zac to rewrite
        heading: `Check it works as a short let`,
        // DRAFT — Zac to rewrite
        intro: `Take this list to the viewing. Tick each one off as you check it.`,
        // DRAFT — Zac to rewrite (the words; keep the ids)
        checklist: [
          { id: 'written-consent', text: `Written consent: will the landlord agree in writing to it being run as serviced accommodation?` },
          { id: 'parking', text: `Parking: is there space for guests, and is it allocated or on the street?` },
          { id: 'access', text: `Access and self check-in: could guests let themselves in with a key safe or smart lock?` },
          { id: 'rules', text: `Building rules and the landlord's own lease: is there anything that limits short lets?` },
          { id: 'neighbours', text: `Noise and neighbours: how close are they, and how would guests affect them?` },
          { id: 'fire-safety', text: `Fire safety: smoke alarms, fire doors and a clear way out.` },
          { id: 'kitchen-bathrooms', text: `Kitchen and bathrooms: their condition, and what the landlord would fix before you start.` },
          { id: 'broadband', text: `Broadband: the speeds available at the address.` },
          { id: 'furnishing', text: `Furnishing: what's included and what you would need to buy.` },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    //  OFFER: the member is ready to make an offer.
    //  Next step: make the offer. The suggested range is further down.
    // ─────────────────────────────────────────────────────────────────────
    offer: {
      purchase: {
        // DRAFT — Zac to rewrite
        heading: `Make your offer`,
        // DRAFT — Zac to rewrite
        intro: `Put your offer in writing, so the agent has to pass it to the seller.`,
        message: {
          id: 'offer-purchase',
          // DRAFT — Zac to rewrite
          subject: `Offer[: {address}]`,
          // DRAFT — Zac to rewrite
          body: `
Hello,

Following my viewing, I'd like to make an offer[ of {offerAmount}] on the property[ at {address}].

Please pass this to the seller and let me know their response.

Thanks,
[{memberName}]
`,
        },
      },
      rentToRent: {
        // DRAFT — Zac to rewrite
        heading: `Make your offer`,
        // DRAFT — Zac to rewrite
        intro: `Put your offer in writing, with the terms, so it goes to the landlord as you meant it.`,
        message: {
          id: 'offer-r2r',
          // DRAFT — Zac to rewrite
          subject: `Company let offer[: {address}]`,
          // DRAFT — Zac to rewrite
          body: `
Hello,

Following the viewing, we'd like to make an offer[ of {offerAmount} a month] to rent the property[ at {address}] on a company let agreement for three to five years.

As discussed, we would run it as serviced accommodation, which needs the landlord's written consent. The rent would be paid every month under the agreement, whether or not the property is occupied.

Please pass this to the landlord and let us know their response.

Thanks,
[{memberName}]
`,
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    //  SECURED: the offer was accepted.
    //  What's next: a checklist, and a low-key line about Stayful managing it.
    // ─────────────────────────────────────────────────────────────────────
    secured: {
      purchase: {
        // DRAFT — Zac to rewrite
        heading: `What's next`,
        // DRAFT — Zac to rewrite
        intro: `Work through these before your first guest.`,
        // DRAFT — Zac to rewrite (the words; keep the ids)
        checklist: [
          { id: 'council', text: `Planning and licensing: check with the local council whether a short let needs permission or a licence.` },
          { id: 'insurance', text: `Insurance: cover written for short lets, not a standard landlord policy.` },
          { id: 'fire-compliance', text: `Fire safety and compliance: a fire risk assessment, alarms, and gas and electrical safety certificates.` },
          { id: 'furnishing-setup', text: `Furnishing and setup: furniture, linen, kitchen kit and a guest guide.` },
          { id: 'photos-listing', text: `Photos and listing: professional photos, then your listings on the booking sites.` },
        ],
      },
      rentToRent: {
        // DRAFT — Zac to rewrite
        heading: `What's next`,
        // DRAFT — Zac to rewrite
        intro: `Work through these before your first guest.`,
        // DRAFT — Zac to rewrite (the words; keep the ids)
        checklist: [
          { id: 'signed-agreement', text: `The signed company let agreement, including the landlord's written consent to serviced accommodation.` },
          { id: 'council', text: `Planning and licensing: check with the local council whether a short let needs permission or a licence.` },
          { id: 'insurance', text: `Insurance: cover written for short lets, not a standard tenant policy.` },
          { id: 'fire-compliance', text: `Fire safety and compliance: a fire risk assessment, alarms, and gas and electrical safety certificates.` },
          { id: 'furnishing-setup', text: `Furnishing and setup: furniture, linen, kitchen kit and a guest guide.` },
          { id: 'photos-listing', text: `Photos and listing: professional photos, then your listings on the booking sites.` },
        ],
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  THE ONE-TAP STAGE BUTTONS
  // ───────────────────────────────────────────────────────────────────────
  moveButtons: {
    // DRAFT — Zac to rewrite
    kept: `I've sent it → move to Contacted`,
    // DRAFT — Zac to rewrite
    contacted: `Viewing booked → move to Viewing`,
    // DRAFT — Zac to rewrite
    viewing: `Making an offer → move to Offer`,
    // DRAFT — Zac to rewrite
    offer: `Offer accepted → move to Secured`,
    // DRAFT — Zac to rewrite
    passed: `Changed your mind? Move back to Kept`,
  },

  // ───────────────────────────────────────────────────────────────────────
  //  BUTTON LABELS
  // ───────────────────────────────────────────────────────────────────────
  buttons: {
    // DRAFT — Zac to rewrite
    copy: `Copy message`,
    // DRAFT — Zac to rewrite
    copied: `Copied`,
    // DRAFT — Zac to rewrite
    email: `Open in email`,
    // DRAFT — Zac to rewrite
    copyFallback: `If copying doesn't work, select the text above and copy it yourself.`,
    // DRAFT — Zac to rewrite (shown before the step's heading on My deals)
    showStep: `Next step:`,
  },

  // ───────────────────────────────────────────────────────────────────────
  //  THE OFFER RANGE (Offer stage)
  //
  //  Fields here: {targetYield} "10%", {targetMargin} "£500",
  //  {targetCeiling} "£182,000", {opening} "£171,000" (the bottom of the
  //  range), {low}, {high}, {motivated} (the figure from the listing's
  //  history), {timeOnMarket} "7 months", {reductions} "twice".
  // ───────────────────────────────────────────────────────────────────────
  offer: {
    // DRAFT — Zac to rewrite
    title: `Suggested offer`,
    // How the figure itself reads.
    figure: {
      purchase: {
        // DRAFT — Zac to rewrite (both figures known)
        range: `{low} to {high}`,
        // DRAFT — Zac to rewrite (both figures land on the same number)
        exact: `{opening}`,
        // DRAFT — Zac to rewrite (only your target is known)
        upTo: `Up to {high}`,
        // DRAFT — Zac to rewrite (only the listing's history is known)
        around: `Around {opening}`,
      },
      rentToRent: {
        // DRAFT — Zac to rewrite
        range: `{low} to {high} a month`,
        // DRAFT — Zac to rewrite
        exact: `{opening} a month`,
        // DRAFT — Zac to rewrite
        upTo: `Up to {high} a month`,
        // DRAFT — Zac to rewrite
        around: `Around {opening} a month`,
      },
    },
    targetPart: {
      // DRAFT — Zac to rewrite
      purchase: `Hits your {targetYield} target up to {targetCeiling}`,
      // DRAFT — Zac to rewrite
      rentToRent: `Leaves your {targetMargin} monthly margin up to {targetCeiling} a month`,
    },
    targetPartAtAsking: {
      // DRAFT — Zac to rewrite
      purchase: `The asking price already hits your {targetYield} target`,
      // DRAFT — Zac to rewrite
      rentToRent: `The asking rent already leaves your {targetMargin} monthly margin`,
    },
    // After the target part, when the listing's history gives the lower figure.
    historyPart: {
      // DRAFT — Zac to rewrite
      ageAndCuts: `on the market {timeOnMarket} and reduced {reductions}, so we'd open at {opening}`,
      // DRAFT — Zac to rewrite
      ageOnly: `on the market {timeOnMarket}, so we'd open at {opening}`,
    },
    // After the target part, when the listing's history gives the higher figure.
    historyPartTop: {
      // DRAFT — Zac to rewrite
      ageAndCuts: `on the market {timeOnMarket} and reduced {reductions}, which puts the top of the range at {motivated}`,
      // DRAFT — Zac to rewrite
      ageOnly: `on the market {timeOnMarket}, which puts the top of the range at {motivated}`,
    },
    targetNote: {
      // DRAFT — Zac to rewrite
      purchase: `Based on your {targetYield} target gross yield.`,
      // DRAFT — Zac to rewrite
      rentToRent: `Based on your {targetMargin} target monthly margin.`,
    },
    // DRAFT — Zac to rewrite
    goalsLink: `Change your targets`,
    missing: {
      // DRAFT — Zac to rewrite
      noAsking: `There's no asking figure on this listing, so we can't suggest an offer.`,
      // DRAFT — Zac to rewrite
      noRevenue: `We don't have short-let income figures for this area and size yet, so we can't check it against your target.`,
      // DRAFT — Zac to rewrite
      studio: `We don't have separate short-let income figures for studios, so we can't check it against your target.`,
      // DRAFT — Zac to rewrite
      noMargin: `At your {targetMargin} target monthly margin, this doesn't work at any rent, so we haven't suggested an offer.`,
      tooFarBelow: {
        // DRAFT — Zac to rewrite
        purchase: `To hit your {targetYield} target you'd need to pay no more than {targetCeiling}. That's more than a quarter below the asking price, so we haven't suggested an offer.`,
        // DRAFT — Zac to rewrite
        rentToRent: `To leave your {targetMargin} monthly margin the rent would need to be {targetCeiling} a month or less. That's more than a quarter below the asking rent, so we haven't suggested an offer.`,
      },
      // DRAFT — Zac to rewrite
      notMarketplace: `The offer guide works on deals from the Stayful marketplace.`,
      // DRAFT — Zac to rewrite
      noHistory: `We don't know how long it has been on the market, so this uses your target only.`,
      // Shown while no discount bands are set at /admin/next-steps. Empty means nothing is shown.
      bandsNotSet: ``,
    },
    // DRAFT — Zac to rewrite
    staleAsking: `We last confirmed the asking figure over a week ago. Check it with the agent before you offer.`,
    // Required wording: keep this label on every offer figure.
    disclaimer: `A guide based on your targets and this listing's history — not financial advice.`,
    amountLabel: {
      // DRAFT — Zac to rewrite
      purchase: `Your offer`,
      // DRAFT — Zac to rewrite
      rentToRent: `Your offer, per month`,
    },
    // DRAFT — Zac to rewrite
    amountHelp: `This goes into the message below. Change it to the figure you want to offer.`,
  },

  // ───────────────────────────────────────────────────────────────────────
  //  WHEN THE LISTING GOES OFF THE MARKET (shown at Kept, Contacted, Viewing)
  // ───────────────────────────────────────────────────────────────────────
  offMarket: {
    // DRAFT — Zac to rewrite
    sold: `The listing now shows this property as sold. Check with the agent before you spend more time on it.`,
    // DRAFT — Zac to rewrite
    under_offer: `The listing now shows this property as under offer. Ask the agent whether the sale is going ahead.`,
    // DRAFT — Zac to rewrite
    let_agreed: `The listing now shows this property as let agreed. Check with the agent before you spend more time on it.`,
    // DRAFT — Zac to rewrite
    removed: `This listing has come off the portal. Check with the agent whether it's still available.`,
  },

  // ───────────────────────────────────────────────────────────────────────
  //  STAYFUL MANAGEMENT (Secured stage). "Talk to us" opens a short form that
  //  sends an enquiry to the Stayful team.
  // ───────────────────────────────────────────────────────────────────────
  manage: {
    // DRAFT — Zac to rewrite
    line: `Want Stayful to manage it for you?`,
    // DRAFT — Zac to rewrite
    linkText: `Talk to us`,
    // DRAFT — Zac to rewrite
    formIntro: `Leave your details and we'll be in touch about managing it.`,
    // DRAFT — Zac to rewrite (the message the form starts with; the member can edit it)
    message: `I've secured a [{bedrooms} ]property[ at {address}] and would like to talk about Stayful managing it.`,
    nameLabel: `Your name`,
    emailLabel: `Email`,
    phoneLabel: `Phone (optional)`,
    messageLabel: `Message`,
    // DRAFT — Zac to rewrite
    send: `Send`,
    // DRAFT — Zac to rewrite
    sent: `Thanks. We'll be in touch about managing it.`,
  },
} satisfies NextStepsContent;
