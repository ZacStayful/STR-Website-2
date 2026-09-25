import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmLink } from "./magic-link.ts";

test("confirmLink points at /auth/confirm with an encoded token hash and next", () => {
  const link = confirmLink("abc/+=123", "/deals?areas=YO");
  const url = new URL(link);
  assert.equal(url.pathname, "/auth/confirm");
  assert.equal(url.searchParams.get("token_hash"), "abc/+=123");
  assert.equal(url.searchParams.get("type"), "magiclink");
  assert.equal(url.searchParams.get("next"), "/deals?areas=YO");
});
