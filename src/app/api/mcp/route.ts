import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { apiAccess } from '@/lib/api/auth';
import { registerTools } from '@/lib/api/mcp-tools';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * The MCP server: Stayful as a set of tools an AI agent can call.
 *
 * Customers get a URL and an API key and connect from Claude or anything
 * else that speaks MCP. Nothing to install, and the key decides the reach.
 *
 * Three decisions here, each verified against the installed SDK (1.30)
 * rather than assumed — this surface has changed across versions:
 *
 * **The web-standard transport, not the Node one.** App Router handlers get
 * a `Request` and return a `Response`; `StreamableHTTPServerTransport`
 * wants Node's `req`/`res`, which do not exist here.
 *
 * **Stateless, and a new server per request.** The SDK's own documentation
 * says stateful mode keeps connections and message history IN MEMORY. On
 * Vercel the next request is a different instance — often a different
 * region — so a session id would be handed out and then rejected as unknown
 * on the very next call. `sessionIdGenerator: undefined` is what makes that
 * explicit rather than accidental.
 *
 * **JSON responses rather than SSE.** Every tool here is one request and one
 * answer; none streams progress. Holding an event stream open would buy
 * nothing and burn function time.
 *
 * Authentication is the same scoped API key as /api/v1, read before a
 * server is built — so an agent is only ever shown the tools its key can
 * actually use. A model shown a tool will eventually call it, and "you do
 * not have that scope" is a worse experience than the tool never existing.
 */

async function handle(request: Request): Promise<Response> {
  const access = await apiAccess(request);
  if (!access.ok || !access.user) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Provide a Stayful API key as a Bearer token. Create one under Leads → API & MCP.' },
        id: null,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          // Points a spec-aware client at where to get credentials rather
          // than leaving it to guess.
          'WWW-Authenticate': 'Bearer realm="Stayful Intelligence"',
        },
      },
    );
  }

  const server = new McpServer(
    { name: 'stayful-intelligence', version: '1.0.0' },
    {
      instructions:
        'Stayful Intelligence analyses UK short-term-let property income and runs white-label lead funnels.\n\n' +
        'Two things are separate and must not be confused: LEADS are strangers who completed one of this ' +
        "account's funnels, and REPORTS are properties the account owner researched themselves.\n\n" +
        'analyse_property spends real money (around £1 a call). Confirm with the user before calling it, and ' +
        'never in a loop. market_snapshot is free and answers most questions about an area.\n\n' +
        'Call whoami first to see what this key is allowed to do.',
    },
  );

  registerTools(server, access);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    // The transport holds the request's streams; nothing here survives to
    // the next invocation, so it is closed rather than leaked.
    await server.close().catch(() => {});
  }
}

export async function POST(request: Request) {
  return handle(request);
}

/**
 * GET opens the standalone server-to-client stream. There is nothing to
 * push — no tool here sends notifications — and in stateless mode there is
 * no session to push into, so the transport's own 405 is the honest answer.
 */
export async function GET(request: Request) {
  return handle(request);
}

/** Session teardown. Stateless, so there is nothing to tear down. */
export async function DELETE(request: Request) {
  return handle(request);
}
