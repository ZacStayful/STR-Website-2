/**
 * The CRM layer: where a customer's leads go once we have run the report.
 *
 * One interface, two implementations in v1 — Monday natively, and a signed
 * webhook for everyone wiring us into n8n, Zapier or Make. Adding HubSpot or
 * Pipedrive later means a new file under providers/ and a row in the picker,
 * and nothing else in this directory changes.
 *
 * Everything here is pure data. No provider imports Supabase, `server-only`
 * or anything about our schema: a provider is handed a resolved connection
 * and a finished payload and its only job is to get that payload into
 * someone else's system. That is what lets the payload builder and the field
 * mapper be tested under `node --test` without a database.
 */

export type CrmProviderId = 'monday' | 'webhook';

/** A customer's connection, with its credential already decrypted. */
export interface ResolvedConnection {
  id: string;
  userId: string;
  provider: CrmProviderId;
  /** Monday: the customer's API token. Webhook: unused. */
  credential: string | null;
  /** Webhook: the shared secret the payload is signed with. */
  webhookSecret: string | null;
  config: Record<string, unknown>;
}

/**
 * Outcome of a push. `retryable` is the field the delivery queue acts on:
 * a 500 or a timeout is worth another go, a 401 or a board that does not
 * exist is not, and retrying it just burns attempts and hides the real
 * error from the customer.
 */
export interface CrmResult {
  ok: boolean;
  /** The id of the thing we created in their system, when it made one. */
  externalId?: string | null;
  error?: string;
  retryable?: boolean;
}

/** One column (Monday) or field a customer can map a lead onto. */
export interface CrmField {
  id: string;
  title: string;
  /** Provider's own type name — 'text', 'email', 'phone', 'date', 'file'… */
  type: string;
}

export interface CrmProvider {
  id: CrmProviderId;
  /** Human name for the picker. */
  label: string;
  /** Round-trips to the provider to prove the credential and config work. */
  testConnection(conn: ResolvedConnection): Promise<CrmResult>;
  /** Monday reads the board's real columns; the webhook has none to read. */
  discoverFields?(conn: ResolvedConnection): Promise<{ fields: CrmField[]; error?: string }>;
  pushLead(conn: ResolvedConnection, payload: LeadPayload, pdf: Uint8Array | null): Promise<CrmResult>;
}

// ─── The payload ──────────────────────────────────────────────────────

/**
 * What a customer's CRM receives. This is a published contract — it is the
 * webhook body an n8n or Zapier workflow is built against — so treat every
 * field name here as load-bearing. Add fields; do not rename or remove them.
 *
 * `version` exists so a future shape change is detectable rather than
 * silently breaking someone's workflow.
 */
export interface LeadPayload {
  version: 1;
  event: 'lead.created';
  leadId: string;
  createdAt: string;
  funnel: { id: string | null; name: string | null };
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    consentAt: string | null;
  };
  property: {
    address: string | null;
    postcode: string | null;
    postcodeArea: string | null;
    bedrooms: number | null;
  };
  /**
   * The headline numbers, lifted out so a workflow does not have to walk the
   * whole report to route on revenue. Null when the report could not
   * produce one, never zero standing in for "unknown".
   */
  metrics: {
    annualRevenue: number | null;
    occupancy: number | null;
    averageNightlyRate: number | null;
    averageReviewCount: number | null;
    saturation: 'uncontested' | 'workable' | 'competitive' | null;
  };
  qualification: {
    /** Null when the report has not run yet (a lead captured out of credit). */
    qualified: boolean | null;
    summary: string;
    /** Rules that could not be measured. Non-zero means a partial verdict. */
    unknownChecks: number;
    checks: Array<{
      rule: string;
      label: string;
      status: 'pass' | 'fail' | 'unknown';
      actual: number | string | null;
      threshold: string;
      reason: string;
    }>;
  };
  report: {
    /** Where the prospect's own copy lives. Null until the report has run. */
    url: string | null;
    /** Direct PDF download, same token. */
    pdfUrl: string | null;
  };
}
