import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, SCOPE_LABELS, type Scope } from './scopes.ts';
import { listLeads, leadStats, getLead, parseLeadQuery } from './leads-query';
import { listReports, getReport } from './reports-query';
import { deleteLead } from './leads-write';
import { saveApiReport } from './reports-write';
import { listFunnels, getFunnel, updateFunnel } from '../funnels';
import { parseLeadRules, rulesAreEmpty } from '../leads/rules';
import { parseAnalysisInput } from '../analysis/input';
import { reserveAnalysis, runAnalysis, GeocodeError } from '../analysis/run';
import { InsufficientCreditError, getBalance } from '../credit/ledger';
import { enqueueDelivery } from '../crm/deliver';
import { getAreaCards } from '../market/cached';
import { saturationBand, SATURATION_GUIDE } from '../market/competition';
import { siteUrl } from '../url';
import type { ApiAccess } from './auth';

/**
 * The MCP tools, mapping onto the same work the v1 routes do.
 *
 * Two things shape every tool here.
 *
 * **Only the tools a key can actually use are registered.** An agent given a
 * read-only key should not SEE `analyse_property` in its tool list, because
 * a model shown a tool will eventually try it, and "you do not have that
 * scope" is a worse experience than the tool never existing. The list is
 * built per request from the key's scopes.
 *
 * **Descriptions are written for a model, not a person.** They say when to
 * reach for a tool and what its numbers mean, because that is what decides
 * whether the right one gets called. In particular they spell out that
 * leads and reports are different things, since nothing about the names
 * alone would stop a model treating them as interchangeable.
 */

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  // isError, rather than a thrown exception: the model should read the
  // problem and decide what to do, not have the call fail underneath it.
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

const LEAD_FILTERS = {
  funnelId: z.string().optional().describe('Only leads from this funnel.'),
  qualified: z.boolean().optional().describe('Only leads that did (true) or did not (false) meet the rules. Omit for both.'),
  status: z.enum(['queued', 'new', 'pushed', 'held', 'exported']).optional()
    .describe('queued: the report has not run yet. held: missed the rules and is waiting for a decision. pushed: already in the CRM.'),
  since: z.string().optional().describe('ISO 8601 date. Leads created at or after it.'),
  until: z.string().optional().describe('ISO 8601 date. Leads created at or before it.'),
};

/** Turns tool arguments back into the same query the REST route parses. */
function queryFrom(args: Record<string, unknown>, limit = 50) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  params.set('limit', String(limit));
  return parseLeadQuery(params);
}

export function registerTools(server: McpServer, access: ApiAccess): string[] {
  const userId = access.user!.id;
  const registered: string[] = [];

  const when = (scope: Scope, register: () => void) => {
    if (!hasScope(access.scopes, scope)) return;
    register();
  };

  // ─── Always available ───────────────────────────────────────────────

  server.registerTool(
    'whoami',
    {
      title: 'Account and credit',
      description:
        'The Stayful account this key belongs to, what this key is allowed to do, and how much credit is left. ' +
        'Worth calling first: it tells you which other tools will work.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const balance = await getBalance(userId).catch(() => null);
      return text({
        email: access.user?.email ?? null,
        scopes: access.scopes,
        permissions: access.scopes.map((s) => SCOPE_LABELS[s]),
        credit: {
          balancePounds: balance ? Math.round(balance.totalPence) / 100 : null,
          // What is left after money already committed to runs in flight —
          // this, not the headline balance, decides whether the next
          // analysis will actually start.
          spendableBasePounds: balance ? Math.round(balance.spendableBasePence) / 100 : null,
        },
      });
    },
  );

  // ─── Leads ──────────────────────────────────────────────────────────

  when('leads:read', () => {
    server.registerTool(
      'list_leads',
      {
        title: 'List leads',
        description:
          'Enquiries from strangers who completed one of this account\'s white-label funnels. ' +
          'NOT the account owner\'s own research — that is list_reports, and the two must never be conflated. ' +
          'Each lead carries the contact, the property, the projected figures and the qualification verdict with the reason for each rule.',
        inputSchema: {
          ...LEAD_FILTERS,
          limit: z.number().int().min(1).max(200).optional().describe('Up to 200. Defaults to 50.'),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const { limit, ...filters } = args as Record<string, unknown> & { limit?: number };
        const q = queryFrom(filters, limit ?? 50);
        if (q.error) return failure(q.error);
        return text(await listLeads(userId, q.value));
      },
    );
    registered.push('list_leads');

    server.registerTool(
      'lead_stats',
      {
        title: 'Qualified vs unqualified counts',
        description:
          'How many leads met the account\'s rules and how many did not, overall and per funnel. ' +
          'Use this for "how is my funnel doing" rather than listing every lead and counting. ' +
          'Queued leads are excluded from the rate: their report has not run, so they have not been judged, ' +
          'and counting them as failures would make a funnel look worse the more often the owner ran out of credit.',
        inputSchema: LEAD_FILTERS,
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const q = queryFrom(args as Record<string, unknown>);
        if (q.error) return failure(q.error);
        return text(await leadStats(userId, q.value));
      },
    );
    registered.push('lead_stats');

    server.registerTool(
      'get_lead',
      {
        title: 'One lead in full',
        description: 'A single lead including every qualification check and why it passed, failed, or could not be measured.',
        inputSchema: { leadId: z.string().describe('The lead id, as returned by list_leads.') },
        annotations: { readOnlyHint: true },
      },
      async ({ leadId }) => {
        const lead = await getLead(userId, leadId);
        return lead ? text(lead) : failure('No lead with that id.');
      },
    );
    registered.push('get_lead');
  });

  when('leads:write', () => {
    server.registerTool(
      'push_lead_to_crm',
      {
        title: 'Send a lead to the CRM',
        description:
          'Sends a lead to the account\'s connected CRM. Use it to promote a held lead — one that missed the ' +
          'qualification rules and was kept back for a decision. Qualified leads are already sent automatically, ' +
          'so pushing one again would create a duplicate row.',
        inputSchema: { leadId: z.string().describe('The lead id.') },
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async ({ leadId }) => {
        // Ownership is proved through the scoped read before anything is
        // queued: enqueueDelivery resolves the owner off the lead itself.
        const lead = await getLead(userId, leadId);
        if (!lead) return failure('No lead with that id.');
        if (!lead.lead.report.url) return failure('That lead has no report yet, so there is nothing to send.');

        const outcome = await enqueueDelivery({ leadId, immediate: true });
        if (!outcome.queued) return failure('No CRM is connected to this account. Connect one under Leads → Integrations first.');
        if (outcome.delivered && !outcome.delivered.ok) {
          return text({ queued: true, delivered: false, error: outcome.delivered.error, note: 'Queued and will be retried automatically.' });
        }
        return text({ queued: true, delivered: Boolean(outcome.delivered?.ok), crmItemId: outcome.delivered?.externalId ?? null });
      },
    );
    registered.push('push_lead_to_crm');

    server.registerTool(
      'delete_lead',
      {
        title: 'Erase a lead',
        description:
          'Permanently erases a lead and everything held about the person: their name, email, phone and the ' +
          'property address. This cannot be undone. It exists so the account owner — who is the data controller ' +
          'for everyone completing their funnel — can honour a deletion request. Confirm with the user before calling it.',
        inputSchema: { leadId: z.string().describe('The lead id.') },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async ({ leadId }) => {
        const ok = await deleteLead(userId, leadId);
        return ok ? text({ deleted: true, leadId }) : failure('No lead with that id.');
      },
    );
    registered.push('delete_lead');
  });

  // ─── Reports ────────────────────────────────────────────────────────

  when('reports:read', () => {
    server.registerTool(
      'list_reports',
      {
        title: 'List your own reports',
        description:
          'Properties the account owner chose to research themselves, through the analyser. ' +
          'NOT leads — those came from strangers completing a funnel and are list_leads. ' +
          'Returns summaries; call get_report for the full analysis of one.',
        inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Up to 200. Defaults to 50.') },
        annotations: { readOnlyHint: true },
      },
      async ({ limit }) => text(await listReports(userId, limit ?? 50, 0)),
    );
    registered.push('list_reports');

    server.registerTool(
      'get_report',
      {
        title: 'One report in full',
        description: 'The complete analysis behind one report: revenue, occupancy, nightly rate, comparables, risks and the deal maths.',
        inputSchema: { reportId: z.string().describe('The report id, as returned by list_reports.') },
        annotations: { readOnlyHint: true },
      },
      async ({ reportId }) => {
        const report = await getReport(userId, reportId);
        return report ? text(report) : failure('No report with that id.');
      },
    );
    registered.push('get_report');
  });

  // ─── Funnels ────────────────────────────────────────────────────────

  when('funnels:read', () => {
    server.registerTool(
      'list_funnels',
      {
        title: 'List funnels',
        description: 'The account\'s white-label lead funnels, their public links, and the qualification rules each one applies.',
        annotations: { readOnlyHint: true },
      },
      async () => {
        const funnels = await listFunnels(userId);
        return text({
          funnels: funnels.map((f) => ({
            id: f.id,
            name: f.name,
            active: f.active,
            url: siteUrl(`/f/${f.publicToken}`),
            reportDepth: f.reportDepth,
            unqualifiedPolicy: f.unqualifiedPolicy,
            rules: f.leadRules,
          })),
        });
      },
    );
    registered.push('list_funnels');

    server.registerTool(
      'get_lead_rules',
      {
        title: 'Read a funnel\'s rules',
        description: 'What decides whether a lead from this funnel counts as qualified.',
        inputSchema: { funnelId: z.string().describe('The funnel id.') },
        annotations: { readOnlyHint: true },
      },
      async ({ funnelId }) => {
        const funnel = await getFunnel(userId, funnelId);
        return funnel ? text({ funnelId, rules: funnel.leadRules }) : failure('No funnel with that id.');
      },
    );
    registered.push('get_lead_rules');
  });

  when('funnels:write', () => {
    server.registerTool(
      'set_lead_rules',
      {
        title: 'Change a funnel\'s rules',
        description:
          'Replaces a funnel\'s qualification rules WHOLESALE — anything you leave out is switched off, so read ' +
          'them with get_lead_rules first and send back the whole set. ' +
          'maxAvgReviewCount is market saturation: under 60 is an uncontested market, 60–100 workable, over 100 established and competitive.',
        inputSchema: {
          funnelId: z.string().describe('The funnel id.'),
          bedroomsMin: z.number().int().min(0).max(20).nullable().optional(),
          bedroomsMax: z.number().int().min(0).max(20).nullable().optional(),
          grossRevenueMin: z.number().min(0).nullable().optional().describe('Minimum projected annual gross, in pounds.'),
          maxAvgReviewCount: z.number().min(0).nullable().optional().describe('Reject markets whose comparables average more reviews than this.'),
          maxCompetitionIntensity: z.number().min(0).max(100).nullable().optional(),
          postcodeAreas: z.array(z.string()).nullable().optional().describe('Only these postcode areas, e.g. ["YO","LS"].'),
          excludePostcodeAreas: z.array(z.string()).nullable().optional(),
        },
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async (args) => {
        const { funnelId, ...raw } = args as { funnelId: string } & Record<string, unknown>;
        const funnel = await getFunnel(userId, funnelId);
        if (!funnel) return failure('No funnel with that id.');

        const rules = parseLeadRules({ ...raw, version: 1 });
        // parseLeadRules is tolerant on READ so a bad stored value never
        // loses a lead. On write that tolerance would let a model switch
        // every filter off by sending something malformed, so a write that
        // understood nothing is refused instead.
        const sent = Object.values(raw).filter((v) => v !== undefined && v !== null).length;
        if (rulesAreEmpty(rules) && sent > 0) {
          return failure('None of those rules could be understood, so nothing was changed. Check the field names and value ranges.');
        }

        const ok = await updateFunnel(userId, funnelId, { leadRules: rules });
        return ok ? text({ funnelId, rules }) : failure('Could not save those rules.');
      },
    );
    registered.push('set_lead_rules');
  });

  // ─── Markets ────────────────────────────────────────────────────────

  when('markets:read', () => {
    server.registerTool(
      'market_snapshot',
      {
        title: 'Market snapshot for a postcode area',
        description:
          'Short-let figures for a UK postcode area: revenue, occupancy, nightly rates and how saturated the ' +
          'market is. Free — it spends no credit and runs no provider call, so prefer it over analyse_property ' +
          'for any question about an area rather than a specific address.',
        inputSchema: { area: z.string().describe('Postcode area letters only, like "YO" or "SW".') },
        annotations: { readOnlyHint: true },
      },
      async ({ area }) => {
        const code = area.trim().toUpperCase();
        if (!/^[A-Z]{1,2}$/.test(code)) return failure('Give a UK postcode area — the letters only, like YO or SW.');
        const card = (await getAreaCards()).find((c) => c.code === code);
        if (!card) return failure(`No market data for ${code} yet. Coverage grows as reports are run.`);
        const reviews = card.competition?.reviews ?? null;
        return text({
          area: { code: card.code, name: card.name },
          headline: card.headline,
          byBedrooms: card.byBedrooms,
          competition: card.competition,
          saturation: saturationBand(reviews),
          saturationGuide: SATURATION_GUIDE,
          confidence: card.confidence,
          licensing: card.licensing,
        });
      },
    );
    registered.push('market_snapshot');
  });

  // ─── Analysis ───────────────────────────────────────────────────────

  when('analyse', () => {
    server.registerTool(
      'analyse_property',
      {
        title: 'Analyse a property',
        description:
          'Runs a full short-let income analysis for one UK address and saves it to the account\'s reports. ' +
          'THIS SPENDS THE ACCOUNT OWNER\'S CREDIT — roughly £1 an analysis — so confirm with the user before ' +
          'calling it, and do not call it speculatively or in a loop. ' +
          'For a question about an area rather than a specific property, use market_snapshot, which is free.',
        inputSchema: {
          address: z.string().describe('Full UK address.'),
          postcode: z.string().describe('UK postcode.'),
          bedrooms: z.number().int().min(1).max(20),
          guests: z.number().int().min(1).max(40).optional(),
          purchasePrice: z.number().min(0).optional().describe('For the buy-to-let maths.'),
          rentPcm: z.number().min(0).optional().describe('Monthly rent, for a rent-to-rent deal instead.'),
        },
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (args) => {
        const parsed = parseAnalysisInput(args);
        if (!parsed.ok) return failure(parsed.error);

        const opts = { billedUserId: userId, requireCredit: true };
        try {
          const prepared = await reserveAnalysis(parsed.input, opts);
          const { result } = await runAnalysis(prepared, parsed.input, opts);
          const reportId = await saveApiReport(userId, parsed.input, result);
          return text({ reportId, result });
        } catch (err) {
          if (err instanceof InsufficientCreditError) {
            return failure('Not enough credit to run this analysis. The account owner needs to top up first. Nothing has been charged.');
          }
          if (err instanceof GeocodeError) return failure(err.message);
          console.error('[mcp] analyse failed:', err);
          return failure('That analysis did not finish. Nothing has been charged for the parts that failed.');
        }
      },
    );
    registered.push('analyse_property');
  });

  return registered;
}
