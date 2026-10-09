import 'server-only';

/**
 * Batch 26: who the chat is talking to, worked out the way the Stayful
 * Intelligence view works it out (src/lib/intelligence/view-server.ts), so
 * an approved answer reads the same in the chat as on the chips:
 *
 *   member   Today's member context for the active profile (the header
 *            view's), with the member's deal visibility (the 48-hour delay)
 *   credit   the header chip's credit snapshot (the team's, for a member)
 *   values   the member's own figures an approved answer may use
 *            (src/lib/knowledge/placeholders.ts MemberValues)
 *
 * Read on every question; nothing here is cached, so a price or a balance
 * is always the one at that moment.
 */
import type { User } from '@supabase/supabase-js';
import { teamCreditSnapshot, type TeamCreditSnapshot } from '../team/credit';
import { getBillingSettings } from '../credit/unit-costs';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getContact } from '../sms/store';
import { usesTailoring } from '../tailoring/profile';
import { checkedCountFor } from '../today/selection';
import { analysisOffer } from '../analysis/offers';
import { offerFloors, offerMemberFor, offerSettings } from '../analysis/offers-server';
import { intelligenceMember } from '../intelligence/view-server';
import type { MemberValues } from '../knowledge/placeholders';
import type { SavedProfile } from '../profiles/rules';
import type { MemberContext } from '../today/selection';

export interface ChatContext {
  profile: SavedProfile | null;
  paused: boolean;
  member: MemberContext;
  credit: TeamCreditSnapshot | null;
  values: MemberValues;
  settings: Awaited<ReturnType<typeof getBillingSettings>>;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}

export async function chatContext(user: Pick<User, 'id' | 'email'>, admin: boolean, now: Date = new Date()): Promise<ChatContext> {
  const [{ profile, paused, member }, settings, credit, offerMember, floors, offerS] = await Promise.all([
    intelligenceMember(user, 'header', now),
    getBillingSettings(),
    teamCreditSnapshot({ id: user.id, admin }).catch(() => null),
    offerMemberFor(user.id),
    offerFloors(),
    offerSettings(),
  ]);
  const [choice, contact] = await Promise.all([
    profile ? checkedCountFor(profile.id, now) : Promise.resolve(null),
    hasServiceRole() ? getContact(createAdminClient(), user.id).catch(() => null) : Promise.resolve(null),
  ]);
  const list = { fullPence: settings.dealPricing.fullAnalysisPence, pmiPence: settings.dealPricing.pmiAddonPence };
  const firstOffer = offerMember?.offerDealIds[0];
  const welcomePrice = firstOffer ? analysisOffer({ dealId: firstOffer, withPmi: false, list, member: offerMember, settings: offerS, floors, now }) : null;
  const deep = analysisOffer({ dealId: '__none__', withPmi: true, list, member: offerMember, settings: offerS, floors, now });
  const values: MemberValues = {
    balancePence: credit?.totalPence ?? null,
    checked: choice?.checked ?? null,
    tailored: usesTailoring(member.tailoring ?? null),
    alertsByText: Boolean(contact?.verified_at && contact.enabled && !contact.stopped_at),
    freeMember: member.visibility.tier === 'free',
    packAvailable: Boolean(credit?.pack),
    welcome:
      welcomePrice?.offer === 'welcome' && offerMember?.revealViewedAt
        ? { fullPence: welcomePrice.fullPence, until: dayLabel(new Date(Date.parse(offerMember.revealViewedAt) + settings.intelligence.revealWelcomeDays * 86_400_000).toISOString()) }
        : null,
    firstDeepPence: deep.offer === 'first_deep' ? Math.round(deep.fullPence + deep.pmiPence) : null,
    // Part F's line comes from the full view's what-if look-up, not here.
    noMatch: null,
  };
  return { profile, paused, member, credit, values, settings };
}
