import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authoriseInternal, internalSecretsConfigured, outboundInternalSecret } from "./internal-auth.ts";

const req = (headers: Record<string, string>) => new Request("https://example.test/api/internal/x", { headers });

beforeEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.INTERNAL_API_SECRET;
  delete process.env.N8N_SHARED_SECRET;
});

test("nothing configured: not configured, nothing authorised", () => {
  assert.equal(internalSecretsConfigured(), false);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "anything" })), false);
});

test("cron bearer is accepted only against CRON_SECRET", () => {
  process.env.CRON_SECRET = "cron";
  assert.equal(internalSecretsConfigured(), true);
  assert.equal(authoriseInternal(req({ authorization: "Bearer cron" })), true);
  assert.equal(authoriseInternal(req({ authorization: "Bearer other" })), false);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "cron" })), false);
});

test("x-internal-secret accepts INTERNAL_API_SECRET everywhere and N8N_SHARED_SECRET only where asked (Batch 21, D25), nothing else", () => {
  process.env.INTERNAL_API_SECRET = "operator";
  process.env.N8N_SHARED_SECRET = "n8n";
  assert.equal(authoriseInternal(req({ "x-internal-secret": "operator" })), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n" })), false);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n" }), { n8n: true }), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "wrong" })), false);
  assert.equal(authoriseInternal(req({})), false);
});

test("N8N_SHARED_SECRET alone is enough to configure the routes, and opens the ones n8n calls", () => {
  process.env.N8N_SHARED_SECRET = "n8n";
  assert.equal(internalSecretsConfigured(), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n" }), { n8n: true }), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n" })), false);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "operator" })), false);
});

test("an unset secret never matches an empty header", () => {
  process.env.INTERNAL_API_SECRET = "operator";
  assert.equal(authoriseInternal(req({ "x-internal-secret": "" })), false);
});

test("outbound webhooks prefer the n8n secret and fall back to the operator one", () => {
  assert.equal(outboundInternalSecret(), undefined);
  process.env.INTERNAL_API_SECRET = "operator";
  assert.equal(outboundInternalSecret(), "operator");
  process.env.N8N_SHARED_SECRET = "n8n";
  assert.equal(outboundInternalSecret(), "n8n");
});

test("Batch 21 (D25): the n8n secret opens only the routes that ask for it; the operator's secret opens every route", () => {
  process.env.INTERNAL_API_SECRET = "ops-secret";
  process.env.N8N_SHARED_SECRET = "n8n-secret";
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n-secret" })), false, "a send, a backfill, a sweep");
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n-secret" }), { n8n: true }), true, "lead provisioning");
  assert.equal(authoriseInternal(req({ "x-internal-secret": "ops-secret" })), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "ops-secret" }), { n8n: true }), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "wrong" }), { n8n: true }), false);
});
