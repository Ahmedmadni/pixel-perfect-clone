import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ReadOnlyAgent, AgentNotReadyError } from "../src/read-only-agent.ts";
import type { BrowserGateway, WorkerHealth } from "../src/browser-gateway.ts";
import type { ControlStore } from "../src/store.ts";
import type { AgentTaskRecord, TaskRepository, TaskStatus } from "../src/task-store.ts";
import type { PermissionRepository } from "../src/review-permissions.ts";
import type { OllamaClient, OllamaChatMessage } from "../src/ollama.ts";
import { initialControl, nextState, type ControlSnapshot } from "../../src/lib/control-machine.ts";

const tabId = "d20e2e9e-7a25-473f-91ae-271324414352";

function fixtures(options: { agentEnabled?: boolean; inspectedText?: string } = {}) {
  let snap: ControlSnapshot = structuredClone(initialControl);
  const records: AgentTaskRecord[] = [];
  const store: ControlStore = {
    ping: async () => {},
    logs: async () => [],
    getSnapshot: async () => snap,
    apply: async (event) => {
      const next = nextState(snap.state, event.type);
      if (!next) return { ok: false, snapshot: snap };
      snap = { ...snap, state: next };
      return { ok: true, snapshot: snap };
    },
  };
  const health: WorkerHealth = {
    ready: true, novnc: true, agentRunnerReady: options.agentEnabled ?? true,
    tabs: 1, mode: "STOPPED", viewOnly: true,
  };
  const browser = {
    health: async () => health,
    tabs: async () => [{ id: tabId, title: "Example", url: "https://example.org/", profileId: "default", active: true }],
    handoff: async (state: WorkerHealth["mode"]) => {
      health.mode = state; health.viewOnly = state !== "MANUAL";
      return health;
    },
    inspect: async (id: string) => {
      if (health.mode !== "AGENT_ACTIVE" || id !== tabId) throw new Error("Control or tab invalid");
      return { tabId: id, title: "Test page", url: "https://example.org/", untrustedPageText: options.inspectedText ?? "Public information visible in the approved tab" };
    },
  } as unknown as BrowserGateway;
  const ollama = {
    listModels: async () => [{ name: "local-model", size: 1, modifiedAt: null, family: null, parameterSize: null }],
    async *chatStream(_model: string, messages: OllamaChatMessage[], signal: AbortSignal) {
      expect(messages[0]?.role).toBe("system");
      expect(messages[1]?.content).toContain("<UNTRUSTED_PAGE>");
      if (signal.aborted) throw new Error("cancelled");
      yield "ملخص محلي ";
      yield "بدون إرسال رسائل";
    },
  } as unknown as OllamaClient;
  const tasks = {
    create: async (input: {objective: string; tabId: string; model: string}) => {
      const task: AgentTaskRecord = { id: randomUUID(), title: input.objective, objective: input.objective, tabId: input.tabId, model: input.model,
        status: "queued", result: null, error: null, steps: [], createdAt: new Date().toISOString(), finishedAt: null };
      records.push(task);
      return task;
    },
    begin: async (id: string) => { const t=records.find((x)=>x.id===id)!; t.status = "running"; },
    step: async (id: string, step: AgentTaskRecord["steps"][number]) => { records.find((x)=>x.id===id)!.steps.push(step); },
    finish: async (id: string, status: "done"|"failed"|"cancelled", result?: string, error?: string) => {
      const t=records.find((x)=>x.id===id)!; t.status=status; t.result=result??null; t.error=error??null; t.finishedAt=new Date().toISOString();
    },
    get: async (id: string) => records.find((x)=>x.id===id)??null,
    list: async () => records,
    recover: async () => {},
  } as TaskRepository;
  const permissions = { isAllowed: async (url: string) => new URL(url).hostname === "example.org" } as PermissionRepository;
  const agent = new ReadOnlyAgent(store,browser,ollama,tasks,permissions,async (fn)=>fn());
  return { agent,records,store,health, browser };
}

async function untilDone(records: AgentTaskRecord[]) {
  for (let i=0;i<80;i++) {
    if (records[0] && ["done","failed","cancelled"].includes(records[0].status)) return;
    await new Promise((resolve)=>setTimeout(resolve,5));
  }
  throw new Error("Task did not finish");
}

describe("supervised read-only AI agent", () => {
  it("refuses tasks until the local agent worker is explicitly enabled", async () => {
    const f = fixtures({agentEnabled:false});
    await expect(f.agent.start({objective:"Review this webpage",tabId,model:"local-model"})).rejects.toBeInstanceOf(AgentNotReadyError);
    expect(f.records).toHaveLength(0);
    expect((await f.store.getSnapshot()).state).toBe("MANUAL");
  });
  it("only reads the approved tab, saves an Arabic report, and returns control", async () => {
    const f = fixtures();
    const task = await f.agent.start({objective:"راجع الصفحة واقترح تقريرًا",tabId,model:"local-model"});
    expect(task.status).toBe("queued");
    await untilDone(f.records);
    expect(f.records[0]?.status).toBe("done");
    expect(f.records[0]?.result).toContain("ملخص محلي");
    expect(f.records[0]?.steps.some((step)=>step.phase==="inspect")).toBe(true);
    // Ownership cleanup is asynchronous after durable task completion.
    for(let i=0;i<40 && (await f.store.getSnapshot()).state!=="MANUAL";i++)
      await new Promise((resolve)=>setTimeout(resolve,5));
    expect((await f.store.getSnapshot()).state).toBe("MANUAL");
    expect(f.health.mode).toBe("MANUAL");
  });
  it("rejects missing Ollama model without claiming the browser is controlled", async () => {
    const f=fixtures();
    await expect(f.agent.start({objective:"Review this webpage",tabId,model:"not-installed"})).rejects.toBeInstanceOf(AgentNotReadyError);
    expect(f.records).toHaveLength(0);
    expect(f.health.mode).toBe("STOPPED");
  });
});
