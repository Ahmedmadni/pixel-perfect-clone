import {test} from "node:test";
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {agentOrigin} from "../src/policy.mjs";
import {inspectPage,runSafeAgentAction} from "../src/agent-operations.mjs";

test("real Playwright: selected synthetic HTTPS tab, never submit or leave site",async()=>{
  const browser=await chromium.launch({headless:true,chromiumSandbox:false,args:["--disable-dev-shm-usage"]});
  const context=await browser.newContext();
  const page=await context.newPage();
  const html='<!doctype html><html><body style="min-height:2600px">' +
    '<h1>Offline test website</h1><a href="/docs">Read docs</a>' +
    '<a href="/delete-account">Delete account</a><a href="https://external.org/">External page</a>' +
    '<input type="search" aria-label="Search" /><input type="password" aria-label="Secret password" />' +
    '<button type="submit">Send message</button></body></html>';
  await context.route("**/*",async(route)=>{
    const u=new URL(route.request().url());
    if(u.origin!=="https://example.org")return route.abort("blockedbyclient");
    await route.fulfill({status:200,contentType:"text/html",body:
      u.pathname==="/docs"?"<!doctype html><h1>Documentation opened in same tab</h1>":html});
  });
  try{
    await page.goto("https://example.org/");
    const origin=agentOrigin(page.url());
    const tabsBefore=context.pages().length;
    const before=await inspectPage(page);
    assert.equal(before.controls.length,6);
    const search=before.controls.find(c=>c.label==="Search");
    const password=before.controls.find(c=>c.label==="Secret password");
    const send=before.controls.find(c=>c.label==="Send message");
    const docs=before.controls.find(c=>c.label==="Read docs");
    const danger=before.controls.find(c=>c.label==="Delete account");
    const external=before.controls.find(c=>c.label==="External page");
    for(const node of [search,password,send,docs,danger,external])assert.ok(node?.id);
    await runSafeAgentAction(page,{action:"fill",elementId:search.id,text:"بحث محلي"},origin);
    assert.equal(await page.getByRole("searchbox",{name:"Search"}).inputValue(),"بحث محلي");
    await assert.rejects(runSafeAgentAction(page,{action:"fill",elementId:password.id,text:"never"},origin),/agent_action_requires_manual_review/);
    await assert.rejects(runSafeAgentAction(page,{action:"follow_link",elementId:send.id},origin),/agent_action_requires_manual_review/);
    await assert.rejects(runSafeAgentAction(page,{action:"follow_link",elementId:danger.id},origin),/agent_action_requires_manual_review/);
    await assert.rejects(runSafeAgentAction(page,{action:"follow_link",elementId:external.id},origin),/agent_left_selected_site/);
    await runSafeAgentAction(page,{action:"scroll",direction:"down"},origin);
    assert.ok(await page.evaluate(()=>scrollY)>0);
    await runSafeAgentAction(page,{action:"follow_link",elementId:docs.id},origin);
    assert.equal(page.url(),"https://example.org/docs");
    assert.equal(context.pages().length,tabsBefore,"must reuse the same tab");
    assert.ok((await page.locator("body").innerText()).includes("Documentation opened"));
    await assert.rejects(runSafeAgentAction(page,{action:"fill",elementId:search.id,text:"stale"},origin),/element_not_found/);
    console.log("PASS: Chromium fill, scroll and same-tab link; dangerous links/actions denied");
  }finally{await context.close();await browser.close();}
});
