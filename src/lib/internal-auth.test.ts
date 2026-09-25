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

test("x-internal-secret accepts INTERNAL_API_SECRET or N8N_SHARED_SECRET, nothing else", () => {
  process.env.INTERNAL_API_SECRET = "operator";
  process.env.N8N_SHARED_SECRET = "n8n";
  assert.equal(authoriseInternal(req({ "x-internal-secret": "operator" })), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n" })), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "wrong" })), false);
  assert.equal(authoriseInternal(req({})), false);
});

test("N8N_SHARED_SECRET alone is enough to configure the routes", () => {
  process.env.N8N_SHARED_SECRET = "n8n";
  assert.equal(internalSecretsConfigured(), true);
  assert.equal(authoriseInternal(req({ "x-internal-secret": "n8n" })), true);
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
