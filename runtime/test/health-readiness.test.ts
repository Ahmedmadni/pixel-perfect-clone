import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { BrowserGateway, WorkerHealth } from "../src/browser-gateway.ts";
import type { OllamaClient } from "../src/ollama.ts";
import type { TaskRepository } from "../src/task-store.ts";
import type { ControlStore } from "../src/store.ts";
import { initialControl } from "../../src/lib/control-machine.ts";
import type { ServiceHealth } from "../../src/lib/api/types.ts";

const cfg={RUNTIME_TOKEN:"x".repeat(64),CORS_ORIGINS:["http://localhost:8080"]};
const goodStore:ControlStore={
  ping:async()=>{},getSnapshot:async()=>initialControl,
  apply:async()=>({ok:false,snapshot:initialControl}),logs:async()=>[],
};
async function inspect(options:{models:number;novnc:boolean;db:boolean;agentRunner:boolean}) {
  const browser={
    health:async()=>({
      ready:true,novnc:options.novnc,agentRunnerReady:options.agentRunner,
      mode:"STOPPED",viewOnly:true,tabs:1,
    } satisfies WorkerHealth),
  } as unknown as BrowserGateway;
  const ollama={
    listModels:async()=>Array.from({length:options.models},(_,i)=>({
      name:`model-${i}`,size:null,modifiedAt:null,parameterSize:null,family:null,
    })),
  } as unknown as OllamaClient;
  const store:ControlStore=options.db?goodStore:{
    ...goodStore,ping:async()=>{throw new Error("simulated DB offline");},
  };
  const app=await buildApp(cfg,store,{browser,ollama,tasks:{} as TaskRepository});
  try {
    const response=await app.inject({url:"/v1/health"});
    expect(response.statusCode).toBe(200);
    return response.json() as {degraded:boolean;services:ServiceHealth[]};
  } finally {await app.close();}
}
function status(data:{services:ServiceHealth[]},service:string) {
  return data.services.find((s)=>s.name===service)?.status;
}
describe("truthful agent and infrastructure readiness",()=>{
  it("does not declare ready without an installed Ollama model",async()=>{
    const value=await inspect({models:0,novnc:true,db:true,agentRunner:true});
    expect(status(value,"ollama")).toBe("up"); // daemon reachable, but model not installed
    expect(status(value,"agent")).toBe("down");
  });
  it("disables agent and marks degraded if noVNC is unavailable",async()=>{
    const value=await inspect({models:1,novnc:false,db:true,agentRunner:true});
    expect(value.degraded).toBe(true);
    expect(status(value,"agent")).toBe("down");
  });
  it("disables agent when PostgreSQL is offline",async()=>{
    const value=await inspect({models:1,novnc:true,db:false,agentRunner:true});
    expect(status(value,"agent")).toBe("down");
    expect(value.degraded).toBe(true);
  });
  it("reports agent up only with a real model, browser, VNC, DB and opt-in runner",async()=>{
    const ready=await inspect({models:1,novnc:true,db:true,agentRunner:true});
    expect(status(ready,"agent")).toBe("up");
    const off=await inspect({models:1,novnc:true,db:true,agentRunner:false});
    expect(status(off,"agent")).toBe("down");
  });
});
