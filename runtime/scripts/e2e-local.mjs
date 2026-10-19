/**
 * CI only: real Fastify + PostgreSQL + Chromium/noVNC via browser worker,
 * with deterministic FAKE Ollama HTTP responses. No real external URLs or accounts.
 */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const token = process.env.RUNTIME_TOKEN;
if (!token || token.length < 32) throw new Error("Runtime token not set in CI");
const root = "http://127.0.0.1:4100";
const bearer = { Authorization: `Bearer ${token}` };

async function request(route, options = {}) {
  const response = await fetch(root+route, {
    ...options,
    headers: {...bearer, ...(options.body ? {"Content-Type":"application/json"} : {}), ...options.headers},
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.text();
  let json=null;
  try { json=JSON.parse(body); } catch {}
  return {status:response.status, json, body};
}
async function waitForIntegration() {
  for(let i=0;i<40;i++){
    try {
      const r=await request("/v1/health");
      const services=Object.fromEntries(r.json?.services.map((s)=>[s.name,s.status])??[]);
      if(services.postgres==="up" && services.ollama==="up" &&
         services.playwright==="up" && services.novnc==="up")return services;
    }catch{}
    await delay(1000);
  }
  throw new Error("Combined Fastify+Postgres+fake Ollama+Chromium health never became ready");
}

console.log("Waiting for four local service boundaries...");
const statuses=await waitForIntegration();
console.log("Services:",JSON.stringify(statuses));
assert.equal((await fetch(root+"/v1/browser/tabs")).status,401);
const originalState=(await request("/v1/agent/status")).json.control;
assert.ok(["MANUAL","STOPPED"].includes(originalState),"Fresh DB may start MANUAL; recovered sessions stay STOPPED");
assert.equal((await request("/v1/models")).json.models[0].name,"ci-fixture:latest");
if (originalState === "STOPPED") {
  const reset=await request("/v1/agent/control",{method:"POST",body:JSON.stringify({type:"RESET"})});
  assert.equal(reset.status,200,"Control RESET must recover a stopped worker");
  assert.equal(reset.json.snapshot.state,"MANUAL");
}

const denied=await request("/v1/agent/control",{method:"POST",body:JSON.stringify({type:"START_AGENT"})});
assert.equal(denied.status,409,"Cannot activate agent without supervised task");

let tabs=await request("/v1/browser/tabs");
assert.equal(tabs.status,200);
assert.ok(Array.isArray(tabs.json)&&tabs.json.length>0,"Persistent real Chromium has a tab");

const add=await request("/v1/browser/tabs",{method:"POST",body:JSON.stringify({action:"new"})});
assert.equal(add.status,200,"Manual browser worker newTab must work");
assert.equal(add.json.tabId.length,36);
tabs=await request("/v1/browser/tabs");
assert.ok(tabs.json.some((t)=>t.id===add.json.tabId),"New Chromium tab should be listed");

const chat=await request("/v1/chat/stream",{
  method:"POST",
  body:JSON.stringify({content:"Please reply using this local CI test model",model:"ci-fixture:latest",conversationId:"e2e-"+Date.now()}),
});
assert.equal(chat.status,200,"Streaming chat must work through real Fastify/Postgres");
assert.ok(chat.body.includes('"type":"delta"'),"Stream should contain deltas");
assert.ok(chat.body.includes('"type":"done"'),"Stream should finish");
assert.ok(chat.body.includes("local CI fixture response"),"Local HTTP fixture must supply result");

const historical=await request("/v1/chat/messages");
assert.equal(historical.status,200,"Chat history should come from PostgreSQL");

const forbidden=await request("/v1/approvals",{headers:{Origin:"https://untrusted.example"}});
assert.equal(forbidden.status,403,"Cross-origin forged request rejected");

// Real PostgreSQL approval and permission flows, with no external send adapter.
const domain="e2e-" + Date.now() + ".example.org";
const createDomain=await request("/v1/accounts",{
  method:"POST",body:JSON.stringify({domain,label:"CI disposable offline domain"}),
});
assert.equal(createDomain.status,201,"Domain registration must be persisted");
assert.equal(createDomain.json.canReview,false,"Site access must start denied");
assert.equal(createDomain.json.canExternalWrite,false,"External writes must remain forbidden");
const policyId=createDomain.json.id;
const allow=await request("/v1/accounts/"+policyId+"/review",{
  method:"POST",body:JSON.stringify({allow:true}),
});
assert.equal(allow.status,200);
assert.equal(allow.json.canReview,true);
assert.equal(allow.json.canExternalWrite,false);
const deny=await request("/v1/accounts/"+policyId+"/review",{
  method:"POST",body:JSON.stringify({allow:false}),
});
assert.equal(deny.status,200);
assert.equal(deny.json.canReview,false);
const accounts=await request("/v1/accounts");
assert.equal(accounts.status,200);
assert.ok(accounts.json.some((item)=>item.id===policyId&&!item.canReview),
  "Revocation must be durable in real PostgreSQL");

const proposal=await request("/v1/approvals",{
  method:"POST",
  body:JSON.stringify({
    kind:"external_message",
    action:"Review non-executable draft",
    target:"Offline CI fixture (not a real account)",
    preview:"This is a local draft and must NOT be sent.",
  }),
});
assert.equal(proposal.status,201,"User approval draft must be persisted");
assert.equal(proposal.json.executable,false);
assert.equal(proposal.json.status,"pending");
const digest=proposal.json.payloadDigest;
assert.match(digest,/^[a-f0-9]{64}$/);
const approvalId=proposal.json.id;
const forged=await request("/v1/approvals/"+approvalId,{
  method:"POST",body:JSON.stringify({decision:"approve",expectedDigest:"0".repeat(64)}),
});
assert.equal(forged.status,409,"Changed draft digest must be denied");
const approved=await request("/v1/approvals/"+approvalId,{
  method:"POST",body:JSON.stringify({decision:"approve",expectedDigest:digest}),
});
assert.equal(approved.status,200);
assert.equal(approved.json.executable,false,"Approval never dispatches writes");
assert.equal(approved.json.status,"approved");
const replay=await request("/v1/approvals/"+approvalId,{
  method:"POST",body:JSON.stringify({decision:"approve",expectedDigest:digest}),
});
assert.equal(replay.status,409,"One-time approval must reject replay");
const approvals=await request("/v1/approvals");
assert.ok(approvals.json.some((item)=>item.id===approvalId&&item.status==="approved"));
const messagesAfter=await request("/v1/chat/messages");
assert.equal(messagesAfter.status,200,"Approval must not alter messaging state");

const stop=await request("/v1/agent/control",{method:"POST",body:JSON.stringify({type:"EMERGENCY_STOP"})});
assert.equal(stop.status,200);
assert.equal(stop.json.snapshot.state,"STOPPED");
console.log("PASS: Real browser tabs/control + Fastify/PostgreSQL + synthetic Ollama streaming + auth + immutable approvals + deny-by-default site permissions + stop");
