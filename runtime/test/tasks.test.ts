import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import type { ControlStore } from "../src/store.ts";
import type { BrowserGateway, WorkerHealth, WorkerTab } from "../src/browser-gateway.ts";
import type { OllamaClient, OllamaChatMessage } from "../src/ollama.ts";
import type { TaskRepository, AgentTaskRecord, TaskStep } from "../src/task-store.ts";
import type { PermissionRepository } from "../src/review-permissions.ts";
import { initialControl, nextState, type ControlSnapshot } from "../../src/lib/control-machine.ts";

const token = "t".repeat(64);
const config = { RUNTIME_TOKEN: token, CORS_ORIGINS: ["http://localhost:8080"] };
const headers = { authorization: `Bearer ${token}` };
const tabId = "b8e70a79-1a4d-4a15-9e0f-c01ad8729fff";

function fake() {
  let snapshot: ControlSnapshot = structuredClone(initialControl);
  const health: WorkerHealth = { ready: true, novnc: true, agentRunnerReady: true, mode: "STOPPED", viewOnly: true, tabs: 1 };
  const store: ControlStore = {
    ping: async () => {},
    getSnapshot: async () => snapshot,
    apply: async (event) => {
      const state = nextState(snapshot.state, event.type);
      if (!state) return { ok: false, snapshot };
      snapshot = { ...snapshot, state };
      return { ok: true, snapshot };
    },
    logs: async () => [],
  };
  const tabs: WorkerTab[] = [{ id: tabId, title: "Example", url: "https://example.com", active: true, profileId: "default" }];
  const browser = {
    health: async () => health,
    tabs: async () => tabs,
    handoff: async (mode: WorkerHealth["mode"]) => {
      health.mode = mode; health.viewOnly = mode !== "MANUAL";
      return health;
    },
    inspect: async () => ({
      tabId, title: "Review page", url: "https://example.com",
      untrustedPageText: "Visible article text for a reviewed web page",
    }),
  } as unknown as BrowserGateway;
  const ollama = {
    listModels: async () => [{ name: "local:latest", size: null, modifiedAt: null, family: null, parameterSize: null }],
    async *chatStream(_name: string, _messages: OllamaChatMessage[], _signal: AbortSignal) {
      yield "ملخص تجريبي من نموذج محلي";
    },
  } as unknown as OllamaClient;
  const memory: AgentTaskRecord[] = [];
  const tasks: TaskRepository = {
    create: async ({objective,tabId,model}) => {
      const row: AgentTaskRecord = { id: randomUUID(), title: objective, objective, tabId, model,
        status: "queued", result: null, error: null, steps: [], createdAt: new Date().toISOString(), finishedAt: null };
      memory.unshift(row);
      return row;
    },
    begin: async (id) => { memory.find((t)=>t.id===id)!.status="running"; },
    step: async (id,step: TaskStep) => { memory.find((t)=>t.id===id)!.steps.push(step); },
    finish: async (id,status,result,error) => {
      const t=memory.find((x)=>x.id===id)!; t.status=status; t.result=result??null; t.error=error??null; t.finishedAt=new Date().toISOString();
    },
    get: async (id) => memory.find((t)=>t.id===id)??null,
    list: async () => memory,
    recover: async () => {},
  };
  const permissions = {isAllowed: async (url:string) => new URL(url).hostname === "example.com"} as PermissionRepository;
  return { store, browser, ollama, tasks, permissions, health, memory };
}
async function settled(task: AgentTaskRecord, delay = 5) {
  for(let i=0;i<100;i++){
    if(["done","failed","cancelled"].includes(task.status)) return;
    await new Promise((r)=>setTimeout(r,delay));
  }
  throw new Error("review did not settle");
}

describe("Phase 2E read-only review HTTP API", () => {
  it("requires authentication and validates model/tab/objective", async () => {
    const f=fake();
    const app=await buildApp(config,f.store,{browser:f.browser,ollama:f.ollama,tasks:f.tasks,permissions:f.permissions});
    expect((await app.inject({url:"/v1/tasks"})).statusCode).toBe(401);
    expect((await app.inject({url:"/v1/tasks",headers})).statusCode).toBe(200);
    const malformed = await app.inject({url:"/v1/tasks", method:"POST", headers, payload:{objective:"x",tabId,model:"local:latest"}});
    expect(malformed.statusCode).toBe(400);
    expect(f.memory).toHaveLength(0);
    const unknownModel = await app.inject({url:"/v1/tasks", method:"POST", headers,
      payload:{objective:"Review webpage",tabId,model:"missing"}});
    expect(unknownModel.statusCode).toBe(503);
    expect(f.memory).toHaveLength(0);
    await app.close();
  });
  it("rejects bare START_AGENT without a supervised task",async ()=>{
    const f=fake();
    const app=await buildApp(config,f.store,{browser:f.browser,ollama:f.ollama,tasks:f.tasks,permissions:f.permissions});
    const r=await app.inject({url:"/v1/agent/control",method:"POST",headers,payload:{type:"START_AGENT"}});
    expect(r.statusCode).toBe(409);
    expect((await app.inject({url:"/v1/agent/status",headers})).json().control).toBe("MANUAL");
    await app.close();
  });
  it("creates a read-only task, saves the report, and returns manual control", async () => {
    const f=fake();
    const app=await buildApp(config,f.store,{browser:f.browser,ollama:f.ollama,tasks:f.tasks,permissions:f.permissions});
    const r=await app.inject({url:"/v1/tasks",method:"POST",headers,payload:{
      objective:"راجع الصفحة واقترح ردودًا دون النشر",tabId,model:"local:latest",
    }});
    expect(r.statusCode).toBe(202);
    const id = r.json().id as string;
    const task = f.memory.find((x)=>x.id===id)!;
    await settled(task);
    expect(task.status).toBe("done");
    expect(task.result).toContain("ملخص تجريبي");
    expect(task.steps.some((step)=>step.phase==="inspect")).toBe(true);
    const detail=await app.inject({url:`/v1/tasks/${id}`,headers});
    expect(detail.statusCode).toBe(200);
    expect(detail.json().result).toContain("ملخص تجريبي");
    for(let i=0;i<40 && (await f.store.getSnapshot()).state!=="MANUAL";i++)
      await new Promise((r)=>setTimeout(r,5));
    expect((await f.store.getSnapshot()).state).toBe("MANUAL");
    await app.close();
  });
});
