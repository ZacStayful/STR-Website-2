import { SCOPES, SCOPE_LABELS, type Scope } from './scopes.ts';

/**
 * The OpenAPI document, built from one description of each route.
 *
 * Served rather than written by hand so it cannot drift from the code, and
 * kept pure so a test can assert the two stay in step — a spec that quietly
 * stops matching is worse than none, because an agent trusts it.
 */

export const API_VERSION = '1.0.0';

export interface RouteSpec {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  summary: string;
  description: string;
  /** Null for the routes any valid key may call. */
  scope: Scope | null;
  params?: Array<{ name: string; in: 'query' | 'path'; type: string; required?: boolean; description: string }>;
  body?: { description: string; example?: Record<string, unknown> };
  /** True where a call costs the customer money. */
  spends?: boolean;
  produces?: string;
}

export const ROUTES: RouteSpec[] = [
  {
    method: 'get', path: '/me', scope: null,
    summary: 'Who this key belongs to',
    description: 'The account behind the key, the scopes it holds and the current credit balance. Needs no scope, so an agent can discover its own reach before trying anything.',
  },
  {
    method: 'post', path: '/analyse', scope: 'analyse', spends: true,
    summary: 'Run a property analysis',
    description: 'Runs the full analysis and returns the result as JSON. This is the only endpoint that spends credit. The report is also saved to the account’s own history.',
    body: {
      description: 'The property to analyse.',
      example: { address: '17 Park Crescent, York', postcode: 'YO31 7NU', bedrooms: 3, guests: 6, purchasePrice: 285000 },
    },
  },
  {
    method: 'get', path: '/reports', scope: 'reports:read',
    summary: 'Your own analyser history',
    description: 'Properties you chose to research. Never leads — those are /leads, and no endpoint returns both.',
    params: [
      { name: 'limit', in: 'query', type: 'integer', description: '1–200. Defaults to 50.' },
      { name: 'offset', in: 'query', type: 'integer', description: 'Zero or more.' },
    ],
  },
  {
    method: 'get', path: '/reports/{id}', scope: 'reports:read',
    summary: 'One report, with its full analysis',
    description: 'The complete AnalysisResult, which the list deliberately leaves out because it is tens of kilobytes per row.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Report id.' }],
  },
  {
    method: 'get', path: '/reports/{id}/pdf', scope: 'reports:read', produces: 'application/pdf',
    summary: 'One report as a PDF',
    description: 'Rendered fresh from the stored analysis.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Report id.' }],
  },
  {
    method: 'get', path: '/leads', scope: 'leads:read',
    summary: 'Leads from your funnels',
    description: 'Each lead is the same object the CRM webhook delivers, so an integration learns one vocabulary rather than two.',
    params: [
      { name: 'funnelId', in: 'query', type: 'string', description: 'Only leads from this funnel.' },
      { name: 'qualified', in: 'query', type: 'boolean', description: '"true" or "false". Omit for both.' },
      { name: 'status', in: 'query', type: 'string', description: 'queued, new, pushed, held or exported.' },
      { name: 'since', in: 'query', type: 'string', description: 'ISO 8601 date; leads created at or after it.' },
      { name: 'until', in: 'query', type: 'string', description: 'ISO 8601 date; leads created at or before it.' },
      { name: 'limit', in: 'query', type: 'integer', description: '1–200. Defaults to 50.' },
      { name: 'offset', in: 'query', type: 'integer', description: 'Zero or more.' },
    ],
  },
  {
    method: 'get', path: '/leads/stats', scope: 'leads:read',
    summary: 'Qualified versus unqualified counts',
    description: 'Overall and per funnel, with the same filters as /leads. Queued leads are excluded from the rate rather than counted as failures: their report has not run, so they have not been judged.',
  },
  {
    method: 'get', path: '/leads/export', scope: 'leads:read', produces: 'text/csv',
    summary: 'Leads as CSV',
    description: 'Up to 1,000 rows per request, with the same filters as /leads.',
  },
  {
    method: 'get', path: '/leads/{id}', scope: 'leads:read',
    summary: 'One lead',
    description: 'Including the qualification verdict and every rule check behind it.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Lead id.' }],
  },
  {
    method: 'post', path: '/leads/{id}/push', scope: 'leads:write',
    summary: 'Send a held lead to your CRM',
    description: 'Promotes a lead that missed your filter. Answers 202 when the delivery is queued but has not landed yet.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Lead id.' }],
  },
  {
    method: 'delete', path: '/leads/{id}', scope: 'leads:write',
    summary: 'Erase a lead',
    description: 'Deletes the row outright, not a flag — this is what makes a deletion request answerable. You are the data controller for everyone who fills in your funnel.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Lead id.' }],
  },
  {
    method: 'get', path: '/funnels', scope: 'funnels:read',
    summary: 'Your funnels and their public links',
    description: 'Includes each funnel’s qualification rules and its public URL.',
  },
  {
    method: 'get', path: '/funnels/{id}/rules', scope: 'funnels:read',
    summary: 'One funnel’s qualification rules',
    description: 'What decides whether a lead is worth your time.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Funnel id.' }],
  },
  {
    method: 'put', path: '/funnels/{id}/rules', scope: 'funnels:write',
    summary: 'Change a funnel’s qualification rules',
    description: 'Replaces the rules wholesale. A body that parses to no rules at all is refused rather than silently switching every filter off.',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Funnel id.' }],
    body: {
      description: 'The rules to store.',
      example: { rules: { version: 1, bedroomsMin: 2, bedroomsMax: 5, grossRevenueMin: 60000, maxAvgReviewCount: 100, postcodeAreas: ['YO', 'LS'] } },
    },
  },
  {
    method: 'get', path: '/markets/{area}', scope: 'markets:read',
    summary: 'Market snapshot for a postcode area',
    description: 'The same figures the Market Explorer shows, plus the saturation band your lead rules are written against. Spends nothing.',
    params: [{ name: 'area', in: 'path', type: 'string', required: true, description: 'Postcode area letters, like YO or SW.' }],
  },
];

const ERROR_CODES = [
  ['unauthorized', 401, 'No key, or one that has been revoked.'],
  ['forbidden', 403, 'The key is valid but lacks the scope. `requiredScope` names it.'],
  ['not_found', 404, 'No such record, or not yours. The two are answered identically.'],
  ['invalid_request', 400, 'A parameter was missing or malformed. `message` says which.'],
  ['insufficient_credit', 402, 'Not enough credit to run that analysis. Nothing was charged.'],
  ['rate_limited', 429, 'Too many requests.'],
  ['server_error', 500, 'Something went wrong at our end.'],
] as const;

function operation(route: RouteSpec): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    '200': {
      description: 'Success.',
      content: { [route.produces ?? 'application/json']: { schema: { type: 'object' } } },
    },
  };
  for (const [code, status, description] of ERROR_CODES) {
    responses[String(status)] = {
      description: `${description} (\`error.code\` is \`${code}\`.)`,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }

  return {
    summary: route.summary,
    description: route.spends
      ? `${route.description}\n\n**This call spends credit.**`
      : route.description,
    operationId: `${route.method}${route.path.replace(/[/{}]/g, '_')}`,
    security: [{ bearerAuth: route.scope ? [route.scope] : [] }],
    parameters: (route.params ?? []).map((p) => ({
      name: p.name,
      in: p.in,
      required: p.in === 'path' ? true : Boolean(p.required),
      description: p.description,
      schema: { type: p.type === 'integer' ? 'integer' : 'string' },
    })),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            description: route.body.description,
            content: { 'application/json': { schema: { type: 'object' }, example: route.body.example } },
          },
        }
      : {}),
    responses,
  };
}

export function openApiDocument(baseUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    paths[route.path] ??= {};
    paths[route.path][route.method] = operation(route);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Stayful Intelligence API',
      version: API_VERSION,
      description:
        'Read your leads, run analyses and change your qualification rules.\n\n' +
        'Authenticate with `Authorization: Bearer sfk_…`. Keys are minted under Leads → Integrations and carry scopes; ' +
        'only `analyse` can spend credit, so a key handed to an agent can be made to read everything and cost nothing.\n\n' +
        'Leads and reports are separate resources throughout. Leads come from strangers completing your funnel; ' +
        'reports are properties you chose to research. No endpoint returns both.',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: `Scopes:\n${SCOPES.map((s) => `- \`${s}\` — ${SCOPE_LABELS[s]}`).join('\n')}`,
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                // The contract an agent branches on. `message` is prose for a
                // log and may change; `code` may not.
                code: { type: 'string', enum: ERROR_CODES.map(([c]) => c) },
                message: { type: 'string' },
                requiredScope: { type: 'string' },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
