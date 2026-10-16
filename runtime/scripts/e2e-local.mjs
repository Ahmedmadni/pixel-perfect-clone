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
assert.equal((await request("/v1/agent/status")).json.control,"STOPPED");
assert.equal((await request("/v1/models")).json.models[0].name,"ci-fixture:latest");

const reset=await request("/v1/agent/control",{method:"POST",body:JSON.stringify({type:"RESET"})});
assert.equal(reset.status,200,"Initial control RESET should work");
assert.equal(reset.json.snapshot.state,"MANUAL");

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

const stop=await request("/v1/agent/control",{method:"POST",body:JSON.stringify({type:"EMERGENCY_STOP"})});
assert.equal(stop.status,200);
assert.equal(stop.json.snapshot.state,"STOPPED");
console.log("PASS: Real browser tabs/control + Fastify/PostgreSQL + synthetic Ollama streaming + auth + stop");
