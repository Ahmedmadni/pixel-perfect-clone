import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { normalizeDomain, PermissionConflictError, type DomainPermission, type PermissionRepository } from "../src/review-permissions.ts";
import type { ControlStore } from "../src/store.ts";
import { initialControl } from "../../src/lib/control-machine.ts";
const TOKEN="p".repeat(64);
const cfg={RUNTIME_TOKEN:TOKEN,CORS_ORIGINS:["http://localhost:8080"]};
const headers={authorization:`Bearer ${TOKEN}`};
function control():ControlStore {
  return {ping:async()=>{},getSnapshot:async()=>initialControl,apply:async()=>({ok:false,snapshot:initialControl}),logs:async()=>[]};
}
function permissions():PermissionRepository {
  const entries:DomainPermission[]=[];
  return {
    list:async()=>entries,
    create:async (input)=>{
      const domain=normalizeDomain(input.domain);
      if(entries.some((e)=>e.domain===domain))throw new PermissionConflictError("duplicate");
      const value:DomainPermission={
        id:randomUUID(),domain,label:input.label,canReview:false,canExternalWrite:false,createdAt:new Date().toISOString(),
      };
      entries.push(value);
      return value;
    },
    setReview:async (id,allowed)=>{
      const item=entries.find((e)=>e.id===id)!;
      item.canReview=allowed;return item;
    },
    isAllowed:async (url)=>{
      const hostname=new URL(url).hostname;
      return entries.some((e)=>e.canReview&&(hostname===e.domain||hostname.endsWith("."+e.domain)));
    },
  };
}
describe("deny-by-default domain permissions",()=>{
  it("rejects public suffixes, malformed domains, and local network targets",()=>{
    for(const domain of ["com","co.uk","localhost","127.0.0.1","https://example.org","evil.com/path","test..com"]) {
      expect(()=>normalizeDomain(domain)).toThrow(PermissionConflictError);
    }
    expect(normalizeDomain("Example.ORG.")).toBe("example.org");
  });
  it("requires authentication, refuses unsupported fields, and defaults to denied",async()=>{
    const app=await buildApp(cfg,control(),{permissions:permissions()});
    expect((await app.inject({url:"/v1/accounts"})).statusCode).toBe(401);
    const invalid=await app.inject({method:"POST",url:"/v1/accounts",headers,payload:{domain:"example.org",label:"Web",canWrite:true}});
    expect(invalid.statusCode).toBe(400);
    const saved=await app.inject({method:"POST",url:"/v1/accounts",headers,payload:{domain:"example.org",label:"Web"}});
    expect(saved.statusCode).toBe(201);
    expect(saved.json().canReview).toBe(false);
    expect(saved.json().canExternalWrite).toBe(false);
    const entries=(await app.inject({url:"/v1/accounts",headers})).json();
    expect(entries[0].session).toBe("unknown");
    expect(entries[0].canAgentControl).toBe(false);
    const enabled=await app.inject({method:"POST",url:`/v1/accounts/${saved.json().id}/review`,headers,payload:{allow:true}});
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().canReview).toBe(true);
    const denied=await app.inject({method:"POST",url:`/v1/accounts/${saved.json().id}/review`,headers,payload:{allow:false}});
    expect(denied.statusCode).toBe(200);
    expect(denied.json().canReview).toBe(false);
    await app.close();
  });
  it("rejects a permission service that is not configured", async()=>{
    const app=await buildApp(cfg,control());
    expect((await app.inject({url:"/v1/accounts",headers})).statusCode).toBe(503);
    await app.close();
  });
});
