import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBrowserUrl, canOperate, validHandoff } from "../src/policy.mjs";

test("agent navigation requires explicitly approved HTTPS domain", () => {
  assert.equal(validateBrowserUrl("https://www.facebook.com/", true, ["facebook.com"]), "https://www.facebook.com/");
  assert.throws(() => validateBrowserUrl("https://fakefacebook.com", true, ["facebook.com"]), /agent_domain_not_approved/);
  assert.throws(() => validateBrowserUrl("http://facebook.com", true, ["facebook.com"]), /agent_requires_https/);
  assert.throws(() => validateBrowserUrl("http://127.0.0.1:4100", true, ["facebook.com"]), /agent_requires_https/);
  assert.throws(() => validateBrowserUrl("file:///etc/passwd"), /invalid_url/);
  assert.throws(() => validateBrowserUrl("javascript:alert(1)"), /invalid_url/);
  assert.throws(() => validateBrowserUrl("https://user:pass@example.com"), /invalid_url/);
});

test("only one party owns interactive operations", () => {
  assert.equal(canOperate("AGENT_ACTIVE", "user", "navigate"), false);
  assert.equal(canOperate("MANUAL", "agent", "navigate"), false);
  assert.equal(canOperate("MANUAL", "user", "navigate"), true);
  assert.equal(canOperate("AGENT_ACTIVE", "agent", "inspect"), true);
  assert.equal(canOperate("STOPPED", "agent", "inspect"), false);
});

test("handoff always requires explicit valid transition", () => {
  assert.equal(validHandoff("STOPPED","AGENT_ACTIVE"), false);
  assert.equal(validHandoff("STOPPED","MANUAL"), true);
  assert.equal(validHandoff("MANUAL","AGENT_ACTIVE"), true);
  assert.equal(validHandoff("AGENT_ACTIVE","MANUAL"), true);
  assert.equal(validHandoff("MANUAL","PAUSED"), false);
});
