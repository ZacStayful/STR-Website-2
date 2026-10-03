/**
 * Batch 24: the first drafts of the knowledge base, for Zac to approve.
 *
 * Written from the three places Stayful Intelligence answered from before
 * Batch 24: the question chips (src/lib/intelligence/answers.ts, Batch 22),
 * the phone agent's service guide (src/lib/voice/agent/service-guide.ts, now deleted,
 * Batch 23) and the site's FAQs (src/lib/faqs-data.ts). Duplicates are
 * merged, every answer is cut to one or two sentences with the figure first,
 * and every figure is a {placeholder}.
 *
 * The seed one-off (runKnowledgeSeed, ?dry=1 first) inserts a missing slug
 * as a draft, and proposes a changed seed text as a draft without touching
 * the live answer. It never approves anything. A later batch that changes a
 * feature, price, limit or rule updates the matching entry here (CLAUDE.md).
 *
 * Pure: no network, no database, no server-only.
 */
import type { EntryContent } from './render.ts';

export interface SeedEntry extends EntryContent {
  slug: string;
  /** Where the text came from, for the reviewer. */
  from: string;
}

export const SEED: readonly SeedEntry[] = [
  // ── The question chips (the Stayful Intelligence view; slugs = CHIP_ORDER) ──
  {
    slug: 'credits',
    from: 'chip credits',
    category: 'credit_billing',
    channels: ['view', 'chat'],
    showWhen: null,
    question: 'How do credits work?',
    variants: ['How much credit do I have?', "What's my balance?", 'What does credit pay for?'],
    answer: 'You have {balance} of credit: it pays for opening deals, daily picks and reports, and top-up credit is spent at {topup_rate} the plan price.',
  },
  {
    slug: 'open_cost',
    from: 'chip open_cost',
    category: 'deals',
    channels: ['view', 'call', 'chat'],
    showWhen: null,
    question: 'What does it cost to open a deal?',
    variants: ['How much is it to open a deal?', 'What does opening a deal cost?', 'Why do some deals cost more to open?'],
    answer: 'Between {open_cost_min} and {open_cost_max} to open a deal, depending on how profitable it is; it comes out of your credit and shows the address and listing.',
  },
  {
    slug: 'pack',
    from: 'chip pack',
    category: 'credit_billing',
    channels: ['view', 'chat'],
    showWhen: 'pack_available',
    question: 'What do I get with the {pack_cost} pack?',
    variants: ['What is the starter pack?', 'Is the starter pack worth it?'],
    answer: '{pack_credit} of credit for {pack_cost}, once: it covers opening deals, your daily picks and reports.',
  },
  {
    slug: 'save',
    from: 'chip save',
    category: 'alerts',
    channels: ['view', 'chat'],
    showWhen: null,
    question: 'What happens when I save a deal?',
    variants: ['Does saving a deal cost anything?', 'What does keep do?', 'Will you tell me if the price drops?'],
    answer: "Saving is free: it goes to My deals and I'll tell you by {#alerts_by_text}email and text{/alerts_by_text}{^alerts_by_text}email{/alerts_by_text} if the price drops, it's back on the market, it's getting attention or it's gone.",
  },
  {
    slug: 'how_picked',
    from: 'chip how_picked',
    category: 'deals',
    channels: ['view', 'chat'],
    showWhen: null,
    question: 'How do you pick my deals?',
    variants: ['How are my deals chosen?', 'Why did you pick these deals?'],
    answer: '{#tailored}I ranked {checked_count} live deals against your answers: must-haves first, then nice-to-haves, the short-let income check and profit.{/tailored}{^tailored}I ranked {checked_count} live deals in your areas and budget by short-let income and profit.{/tailored}',
  },
  {
    slug: 'analysis',
    from: 'chip analysis',
    category: 'reports',
    channels: ['view', 'chat'],
    showWhen: null,
    question: "What's in a full analysis and a deep report?",
    variants: ['What do I get in a full analysis?', 'What is a deep report?', 'What does PMI add?'],
    answer: "A full analysis is {full_analysis_cost}{#welcome_offer} ({welcome_cost} on your matches until {welcome_until}){/welcome_offer}: it opens the deal with {forecast_months} months of short-let income, costs, comparables and due-diligence checks. A deep report adds PMI's second opinion for {deep_report_cost}{#first_deep_offer} ({first_deep_cost} your first time){/first_deep_offer}.",
  },
  {
    slug: 'free_delay',
    from: 'chip free_delay',
    category: 'deals',
    channels: ['view', 'chat'],
    showWhen: 'free_delay_applies',
    question: 'Why do free members see deals later?',
    variants: ['Why are deals delayed for me?', 'Why do I see new deals late?'],
    answer: 'Free members see a new deal {free_delay_hours} hours after it goes live; members who have paid see it straight away.',
  },
  {
    slug: 'calls',
    from: 'chip calls',
    category: 'calls',
    channels: ['view', 'chat'],
    showWhen: null,
    question: 'How do calls from you work?',
    variants: ['What do your calls cost?', 'Will you phone me?'],
    answer: "About {call_minute_cost} a minute from your credit, only if you've said yes: missed calls are free, texts {text_cost} and emails {email_cost}.{^calls_live} I'm not making calls yet.{/calls_live}",
  },
  {
    slug: 'topup',
    from: 'chip topup',
    category: 'credit_billing',
    channels: ['view', 'chat'],
    showWhen: null,
    question: 'How do I top up or turn on auto top-up?',
    variants: ['How do I add credit?', 'How do I buy more credit?'],
    answer: 'Top up {topup_amounts} in Account → Billing; auto top-up adds your chosen amount when you drop below your limit and needs a saved card.',
  },
  {
    slug: 'no_match',
    from: 'chip no_match',
    category: 'deals',
    channels: ['view', 'chat'],
    showWhen: 'no_match',
    question: "Why can't you find me anything?",
    variants: ['Why are there no deals for me?', 'Why am I not getting any matches?'],
    answer: '{no_match_line}',
  },

  // ── The phone agent's service guide (calls; most also for the chat) ──
  {
    slug: 'what_it_does',
    from: 'guide.what',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'What does Stayful Intelligence do?',
    variants: ['What is Stayful Intelligence?', 'What is this service?', 'Who are you?'],
    answer: 'It searches UK short-let deals every day, to buy and rent-to-rent, and picks the ones that fit what you told us you want, with figures from comparables and the properties Stayful runs.',
  },
  {
    slug: 'how_picks_work',
    from: 'guide.picks',
    category: 'deals',
    // The chat answers this from the how_picked chip, which knows the member's own count.
    channels: ['call'],
    showWhen: null,
    question: 'How are deals picked for me?',
    variants: ['How does the matching work?', 'How do I get better matches?'],
    answer: 'Every day the deals that best fit your budget, areas and kind of deal show on Today and in your daily email, and the more you answer and keep or pass, the better they get.',
  },
  {
    slug: 'reports',
    from: 'guide.reports + faq.6',
    category: 'reports',
    channels: ['call'],
    showWhen: null,
    question: 'What does a full analysis cost and include?',
    variants: ['How much is a report?', 'What is in a report?', 'How much does PMI cost?'],
    answer: "A Full analysis is {full_analysis_cost} and gives {forecast_months} months of short-let income, costs, comparables, risks and the local market; with PMI's second opinion it is {deep_report_cost}.",
  },
  {
    slug: 'credit_how',
    from: 'guide.credit',
    category: 'credit_billing',
    channels: ['call'],
    showWhen: null,
    question: 'How does credit work?',
    variants: ['How do I pay?', 'Do I need a subscription?', 'What is my balance?'],
    answer: 'Everything is paid from credit: top up any time or take a plan for monthly credit, and Account → Billing shows what each thing costs. I never say a balance on the phone; it is in the app.',
  },
  {
    slug: 'auto_topup',
    from: 'guide.autotopup',
    category: 'credit_billing',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'What is auto top-up?',
    variants: ['How do I turn on auto top-up?', 'Can you top me up automatically?'],
    answer: 'The one-tap offer adds {auto_topup_amount} whenever your balance drops below {auto_topup_threshold}, so searches never stop; you can choose other amounts in Account → Billing, and it needs a saved card.',
  },
  {
    slug: 'calls_how',
    from: 'guide.calls',
    category: 'calls',
    channels: ['call'],
    showWhen: null,
    question: 'Why are you calling me, and what does it cost?',
    variants: ['When do you call?', 'How much do calls cost?', 'Do missed calls cost anything?'],
    answer: 'Answered calls cost about {call_minute_cost} a minute and missed calls are free: I only call members who said yes, on {call_days} between {call_hours_start} and {call_hours_end}, and texts are {text_cost}, emails {email_cost}.',
  },
  {
    slug: 'stop_calls',
    from: 'guide.stop',
    category: 'calls',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'How do I stop the calls or texts?',
    variants: ['Stop calling me', 'How do I turn off texts?', 'Unsubscribe me'],
    answer: 'Switch calls off in Account → Notifications, or reply STOP to any text; I never change settings on a call, so I point you to the app.',
  },
  {
    slug: 'phone_privacy',
    from: 'guide.privacy',
    category: 'calls',
    channels: ['call'],
    showWhen: null,
    question: "Why won't you tell me my balance or the address?",
    variants: ['Can you read me the address?', 'Can I pay by card on the phone?'],
    answer: "Anyone could ring from a spoofed number, so I never say an address, a balance or a deal's figures on the phone, and I never take card details; they are all in the app.",
  },
  {
    slug: 'talk_to_team',
    from: 'guide.team',
    category: 'account',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'Can I talk to a person?',
    variants: ['I want a refund', 'Something is not working', 'How do I contact Stayful?'],
    answer: "For anything I can't help with, like billing disputes, refunds or something not working, I pass it to the Stayful team, who reply by email; you can also email {team_email}.",
  },
  {
    slug: 'management',
    from: 'guide.management + faq.8',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: "Is this the same as Stayful's management service?",
    variants: ['Can Stayful manage my property?', 'What does Stayful Management cost?'],
    answer: 'No: Stayful Management is a separate full-service offering that runs short-lets for owners at {management_fee}, and most members never use it.',
  },

  // ── The site's FAQs and trust FAQs (calls and the chat) ──
  {
    slug: 'what_it_costs',
    from: 'faq.6',
    category: 'credit_billing',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'What does it cost?',
    variants: ['How much is Stayful?', 'Is it free?', 'How much is a plan?'],
    answer: 'Every account starts with {welcome_credit} of free credit, about {analyses_in_welcome} Full analyses; after that plans start at {lowest_plan_cost} a month, or top up from {min_topup}, spent at {topup_rate} the plan rate.',
  },
  {
    slug: 'analyser_output',
    from: 'faq.1',
    category: 'reports',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'What does the Property Analyser actually output?',
    variants: ['What is in the analyser report?', 'What sections are in the report?'],
    answer: 'A {report_sections}-section report: live comparables, amenities and demand, a gross-to-net revenue breakdown, a {forecast_months}-month forecast, the local area, a furnishing quote and a risk assessment, every figure sourced.',
  },
  {
    slug: 'data_sources',
    from: 'faq.2',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'Where does the data come from?',
    variants: ['Where do your figures come from?', 'What data do you use?'],
    answer: 'Airbtics for live Airbnb comparables, PropertyData for long-let values and area data, Google Places for amenities and Ticketmaster for events; every source is named on the figure it produces.',
  },
  {
    slug: 'bold_claims',
    from: 'faq.3 + trust.4',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'Is this making bold revenue claims?',
    variants: ['Are your income figures realistic?', 'Is this a best-case projection?'],
    answer: 'No: you see what comparable properties in your postcode actually earn, quiet months included, so the figure you take into a decision is one you can defend to a lender.',
  },
  {
    slug: 'vs_competitors',
    from: 'faq.4',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'How is this different from Airdna or AirROI?',
    variants: ['Why not use Airdna?', 'How do you compare to other tools?'],
    answer: 'Those tools tell you what an area earns; Stayful tells you what to do about a specific property, step by step, to win in its postcode.',
  },
  {
    slug: 'technical',
    from: 'faq.5',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'Do I need to be technical to use it?',
    variants: ['Is it hard to use?', 'Do I need spreadsheets?'],
    answer: 'No: type an address and click analyse; there is no setup, no configuration and no spreadsheet to build.',
  },
  {
    slug: 'prospective',
    from: 'faq.7',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: "Can I use this for properties I don't own yet?",
    variants: ['Can I analyse a property before I buy it?', 'Can I check a deal before making an offer?'],
    answer: "Yes, that's the most common use: investors run deals through the Analyser before making an offer, and the setup costs and risk score are built for that.",
  },
  {
    slug: 'forecast_accuracy',
    from: 'trust.1',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: 'How do you know your forecasts are accurate?',
    variants: ['Are your forecasts right?', 'Can I trust the income estimate?'],
    answer: 'We run the properties, so we check: for the {ledger_properties} short-lets Stayful took on in {ledger_year}, the methodology page shows each estimate beside {forecast_months} months of real bookings, a small sample and we say so.',
  },
  {
    slug: 'conflict_of_interest',
    from: 'trust.2',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: "Isn't it a conflict of interest that you're also a management company?",
    variants: ['Do you inflate figures to win management?', 'Why should I trust a management company?'],
    answer: "It's a fair question: each estimate is made before we know whether the property will come under management, and we publish the variance either way, including where the model was wrong.",
  },
  {
    slug: 'nightly_rate',
    from: 'trust.3',
    category: 'how_it_works',
    channels: ['chat'],
    showWhen: null,
    question: "Why isn't nightly rate in the forecast-vs-actual table?",
    variants: ['Where is the nightly rate comparison?'],
    answer: 'Our forecast and a host dashboard measure nightly rate on different terms, so we leave it out until we can publish both alike; owner net is measured the same way on both, so the ledger reports that.',
  },
  {
    slug: 'outside_managed_areas',
    from: 'trust.5',
    category: 'how_it_works',
    channels: ['call', 'chat'],
    showWhen: null,
    question: "What happens where you don't manage properties?",
    variants: ['Is the data as good outside your areas?'],
    answer: 'You get the market data every platform has, live comparables, long-let benchmarks and demand drivers, and the report says which figures come from our own properties and which do not.',
  },
];

/**
 * The phone agent's old knowledge ids (Batch 23: positions in the FAQ lists
 * and the guide's ids) → the slug that replaced each, so a question logged
 * before the switch still counts on Coverage.
 */
export const LEGACY_REFS: Readonly<Record<string, string>> = {
  'guide.what': 'what_it_does',
  'guide.picks': 'how_picks_work',
  'guide.reports': 'reports',
  'guide.credit': 'credit_how',
  'guide.autotopup': 'auto_topup',
  'guide.calls': 'calls_how',
  'guide.stop': 'stop_calls',
  'guide.privacy': 'phone_privacy',
  'guide.team': 'talk_to_team',
  'guide.management': 'management',
  'faq.1': 'analyser_output',
  'faq.2': 'data_sources',
  'faq.3': 'bold_claims',
  'faq.4': 'vs_competitors',
  'faq.5': 'technical',
  'faq.6': 'what_it_costs',
  'faq.7': 'prospective',
  'faq.8': 'management',
  'trust.1': 'forecast_accuracy',
  'trust.2': 'conflict_of_interest',
  'trust.3': 'nightly_rate',
  'trust.4': 'bold_claims',
  'trust.5': 'outside_managed_areas',
};

/** A knowledge_ref as logged ("[slug]", "slug", or an old id) → the slug, or null. */
export function refToSlug(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const r = ref.trim().replace(/^\[|\]$/g, '').trim();
  if (!r) return null;
  return LEGACY_REFS[r] ?? r;
}

/** What the seed knows about an existing row. */
export interface SeedRowState {
  slug: string;
  seedHash: string | null;
  draftState: 'none' | 'pending' | 'rejected';
  draftSource: string | null;
}

export interface SeedPlan {
  /** New slugs: inserted as pending drafts. */
  insert: SeedEntry[];
  /** Seed text changed since it was last seeded: proposed as a draft; the live answer is untouched. */
  propose: SeedEntry[];
  /** Seed text changed but Zac has a draft of his own pending: left alone. */
  skipped: { slug: string; reason: string }[];
  unchanged: string[];
}

/**
 * What a seed run would do. Never approves, never touches a live answer, and
 * never replaces a draft Zac is working on (a pending draft not from the
 * seed). A slug whose seed text is unchanged since it was seeded is left
 * alone, so Zac's own edits are not proposed back at him.
 */
export function planSeed(rows: readonly SeedRowState[], seed: readonly SeedEntry[], hash: (e: SeedEntry) => string): SeedPlan {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const plan: SeedPlan = { insert: [], propose: [], skipped: [], unchanged: [] };
  for (const e of seed) {
    const r = bySlug.get(e.slug);
    if (!r) {
      plan.insert.push(e);
      continue;
    }
    if (r.seedHash === hash(e)) {
      plan.unchanged.push(e.slug);
      continue;
    }
    if (r.draftState === 'pending' && r.draftSource !== 'seed') {
      plan.skipped.push({ slug: e.slug, reason: 'a draft of your own is pending' });
      continue;
    }
    plan.propose.push(e);
  }
  return plan;
}
