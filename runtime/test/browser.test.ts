import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { BrowserGateway, WorkerHealth, WorkerTab } from "../src/browser-gateway.ts";
import type { ControlStore } from "../src/store.ts";
import { initialControl, nextState, type ControlSnapshot } from "../../src/lib/control-machine.ts";

const token = "b".repeat(64);
const config = { RUNTIME_TOKEN: token, CORS_ORIGINS: ["http://localhost:8080"] };
const auth = { authorization: `Bearer ${token}` };
const tabs: WorkerTab[] = [{
  id: "ab1b334f-2000-4000-8000-41441326a999", title: "Test tab",
  url: "about:blank", profileId: "local-default", active: true,
}];
function store(): ControlStore {
  let snap: ControlSnapshot = initialControl;
  return {
    ping: async () => {},
    getSnapshot: async () => snap,
    apply: async (e) => {
      const newState = nextState(snap.state, e.type);
      if (!newState) return { ok: false, snapshot: snap };
      snap = { state: newState, reason: null, history: [] };
      return { ok: true, snapshot: snap };
    },
    logs: async () => [],
  };
}
function gateway(): BrowserGateway {
  const health: WorkerHealth = {
    ready: true, novnc: true, tabs: 1, viewOnly: true, mode: "STOPPED",
    agentRunnerReady: false,
  };
  return {
    health: async () => health,
    tabs: async () => tabs,
    handoff: async (mode: WorkerHealth["mode"]) => {
      health.mode = mode; health.viewOnly = mode !== "MANUAL";
      return health;
    },
    ensureManual: async () => {
      health.mode = "MANUAL"; health.viewOnly = false;
    },
    newTab: async () => ({ tabId: tabs[0]!.id }),
    activateTab: async (tabId: string) => ({ tabId }),
    closeTab: async () => ({ closed: true }),
    navigate: async (tabId: string, url: string) => ({ tabId, url }),
  } as unknown as BrowserGateway;
}

describe("Phase 2C browser runtime bridge", () => {
  it("rejects tabs without authentication", async () => {
    const app = await buildApp(config, store(), { browser: gateway() });
    expect((await app.inject({url: "/v1/browser/tabs"})).statusCode).toBe(401);
    await app.close();
  });
  it("reports real worker and noVNC independently of autonomous agent", async () => {
    const app = await buildApp(config, store(), { browser: gateway() });
    const h = (await app.inject({url: "/v1/health"})).json();
    expect(h.services.find((s: {name: string}) => s.name === "playwright").status).toBe("up");
    expect(h.services.find((s: {name: string}) => s.name === "novnc").status).toBe("up");
    expect(h.services.find((s: {name: string}) => s.name === "agent").status).toBe("unknown");
    await app.close();
  });
  it("lists real tabs and accepts manual tab actions", async () => {
    const app = await buildApp(config, store(), { browser: gateway() });
    const response = await app.inject({url: "/v1/browser/tabs", headers: auth});
    expect(response.statusCode).toBe(200);
    expect(response.json()[0].profileId).toBe("local-default");
    const cmd = await app.inject({
      url: "/v1/browser/tabs", method: "POST", headers: auth,
      payload: {action: "activate", tabId: tabs[0]!.id},
    });
    expect(cmd.statusCode).toBe(200);
    await app.close();
  });
  it("refuses agent takeover if no autonomous runner exists", async () => {
    const app = await buildApp(config, store(), { browser: gateway() });
    const result = await app.inject({
      url: "/v1/agent/control", method: "POST", headers: auth,
      payload: { type: "START_AGENT" },
    });
    expect(result.statusCode).toBe(503);
    expect((await app.inject({url: "/v1/agent/status", headers: auth})).json().control).toBe("MANUAL");
    await app.close();
  });
  it("rejects malformed or unauthorized browser navigation", async () => {
    const app = await buildApp(config, store(), { browser: gateway() });
    const malformed = await app.inject({url: "/v1/browser/tabs", method: "POST", headers: auth, payload: {action: "navigate", url: "javascript:alert(1)"}});
    expect(malformed.statusCode).toBe(400);
    const foreign = await app.inject({url: "/v1/browser/tabs", method: "POST", headers: { ...auth, origin: "https://unknown.example" }, payload: {action: "new"}});
    expect(foreign.statusCode).toBe(403);
    await app.close();
  });
});
