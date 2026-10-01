/**
 * Batch 23: a short written guide to the service, for the phone agent's
 * knowledge alongside src/lib/faqs-data.ts. DRAFT FOR ZAC'S APPROVAL —
 * Batch 24's knowledge base replaces this with real answers.
 *
 * Plain facts only. The prices are passed in from the live settings, so the
 * guide can never quote a price the site doesn't charge. No balances, no
 * deals, no addresses.
 *
 * Pure.
 */

export interface GuideFigures {
  callPencePerMin: number;
  textPence: number;
  emailPence: number;
  topupAmountPence: number;
  topupThresholdPence: number;
}

const money = (pence: number) => (pence < 100 ? `${Math.round(pence)}p` : pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`);

export interface GuideEntry {
  id: string;
  topic: string;
  text: string;
}

export function serviceGuide(f: GuideFigures): GuideEntry[] {
  return [
    { id: 'guide.what', topic: 'What Stayful Intelligence does', text: 'Stayful Intelligence searches thousands of UK short-let deals every day — properties to buy and rent-to-rent opportunities — and picks the ones that fit what the member told us they want. Its figures come from the comparables and from the real operating data of the properties Stayful runs.' },
    { id: 'guide.picks', topic: 'How deals are picked', text: "Each member answers a few questions about their budget, areas and the kind of deal they want. Every day the strongest matches show on their Today page and in their daily email. The more they answer and the more deals they keep or pass, the better the matches get." },
    { id: 'guide.reports', topic: 'Reports', text: 'From any deal a member can open a full analysis: comparables, a month-by-month income estimate, costs, risks and the local market. Prices for each are shown in the app before anything is charged.' },
    { id: 'guide.credit', topic: 'Credit', text: 'Everything is paid from credit. Members can top up any time, subscribe to a plan for monthly credit, and see what each thing costs in Account, Billing & usage. Exact balances are only ever shown in the app, never said on the phone.' },
    { id: 'guide.autotopup', topic: 'Auto top-up', text: `Auto top-up adds ${money(f.topupAmountPence)} of credit whenever the balance drops below ${money(f.topupThresholdPence)}, so searches never stop. It is switched on, changed or switched off in Account, Billing & usage. On a call I can text a one-tap link to switch it on.` },
    { id: 'guide.calls', topic: 'Calls and texts from Stayful Intelligence', text: `Calls only happen for members who said yes. I call to introduce myself once, when credit is running low, and (later) about a standout deal. Calls are on weekdays between 9am and 7pm; members can ring this number back any time. Answered calls cost about ${money(f.callPencePerMin)} a minute from credit; missed calls are free. Texts cost ${money(f.textPence)} and emails ${money(f.emailPence)}.` },
    { id: 'guide.stop', topic: 'Stopping calls or texts', text: 'Members can switch calls off in Account, Notifications, or reply STOP to any text. I never change settings on a call; I point them to the app.' },
    { id: 'guide.privacy', topic: 'Privacy and safety on the phone', text: "Because anyone could ring from a spoofed number, I never say an address, an exact balance or a deal's figures on the phone, and I never take card details. Those are all in the app." },
    { id: 'guide.team', topic: 'Talking to a person', text: "For anything I can't help with — billing disputes, refunds, something not working — I pass it to the Stayful team, who reply by email. Members can also email hello@stayful.co.uk." },
    { id: 'guide.management', topic: 'Stayful management', text: 'Separately, Stayful runs short-lets for owners as a management company. The deal service and management are different things; anyone interested in management can ask the team.' },
  ];
}
