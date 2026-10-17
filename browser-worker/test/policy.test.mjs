import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBrowserUrl, canOperate, validHandoff,
  agentOrigin,validateScopedAgentUrl,safeNavigationLink,safeTextControl } from "../src/policy.mjs";

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

test("agent is restricted to EXACT selected public HTTPS origin, never local or other tab",()=>{
  const site=agentOrigin("https://example.org/docs");
  assert.equal(site,"https://example.org");
  assert.equal(validateScopedAgentUrl("https://example.org/next",site),"https://example.org/next");
  for(const url of [
    "http://example.org/","https://other.org/","https://blog.example.org/",
    "https://127.0.0.1/","https://localhost/","https://router.local/",
    "https://example.org:8443/"
  ]) assert.throws(()=>validateScopedAgentUrl(url,site));
});
test("unsafe links and submit controls are never automatic agent steps",()=>{
  const site="https://example.org";
  assert.equal(safeNavigationLink("https://example.org/docs","Documentation",site),"https://example.org/docs");
  for(const url of ["https://example.org/delete-account","https://example.org/logout",
    "https://example.org/?action=unsubscribe","https://evil.org/path"]) {
    assert.throws(()=>safeNavigationLink(url,"Continue",site));
  }
  assert.equal(safeTextControl("INPUT","search",false,false),true);
  assert.equal(safeTextControl("TEXTAREA","",false,false),true);
  assert.equal(safeTextControl("INPUT","password",false,false),false);
  assert.equal(safeTextControl("INPUT","text",true,false),false);
  assert.equal(canOperate("AGENT_ACTIVE","agent","fill"),true);
  assert.equal(canOperate("MANUAL","agent","fill"),false);
  assert.equal(canOperate("AGENT_ACTIVE","agent","submit"),false);
});
