import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { StoreUnavailableError, type ControlStore } from "../src/store.ts";
import { initialControl, nextState, type ControlSnapshot } from "../../src/lib/control-machine.ts";

const TOKEN = "t".repeat(64);
const cfg = { RUNTIME_TOKEN: TOKEN, CORS_ORIGINS: ["http://localhost:8080"] };
const auth = { authorization: `Bearer ${TOKEN}` };

/** Test double only — never used by the real runtime. */
function memStore(): ControlStore {
  let snap: ControlSnapshot = initialControl;
  return {
    ping: async () => {},
    getSnapshot: async () => snap,
    apply: async (e) => {
      const to = nextState(snap.state, e.type);
      if (!to) return { ok: false, snapshot: snap };
      snap = { state: to, reason: null, history: [{ at: "", from: snap.state, to, event: e.type }, ...snap.history] };
      return { ok: true, snapshot: snap };
    },
    logs: async () => [],
  };
}
const down: ControlStore = {
  ping: async () => { throw new StoreUnavailableError("ECONNREFUSED"); },
  getSnapshot: async () => { throw new StoreUnavailableError("x"); },
  apply: async () => { throw new StoreUnavailableError("x"); },
  logs: async () => { throw new StoreUnavailableError("x"); },
};

describe("runtime API", () => {
  it("requires bearer token on protected routes", async () => {
    const app = await buildApp(cfg, memStore());
    expect((await app.inject({ url: "/v1/agent/status" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/agent/status", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/agent/status", headers: auth })).statusCode).toBe(200);
  });

  it("rejects foreign origins", async () => {
    const app = await buildApp(cfg, memStore());
    const r = await app.inject({ url: "/v1/health", headers: { origin: "https://evil.example" } });
    expect(r.statusCode).toBe(403);
  });

  it("applies valid transitions and returns 409 for invalid", async () => {
    const app = await buildApp(cfg, memStore(), { browserReady: () => true });
    const post = (body: unknown) => app.inject({ method: "POST", url: "/v1/agent/control", headers: auth, payload: body as object });
    const ok = await post({ type: "START_AGENT" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().snapshot.state).toBe("AGENT_ACTIVE");
    expect((await post({ type: "EMERGENCY_STOP" })).json().snapshot.state).toBe("STOPPED");
    const bad = await post({ type: "START_AGENT" });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().snapshot.state).toBe("STOPPED");
  });

  it("refuses to report agent active before a real browser worker is verified", async () => {
    const app = await buildApp(cfg, memStore());
    const result = await app.inject({ method: "POST", url: "/v1/agent/control", headers: auth, payload: { type: "START_AGENT" } });
    expect(result.statusCode).toBe(503);
    expect(result.json().error).toBe("browser_agent_not_ready");
  });

  it("validates bodies strictly", async () => {
    const app = await buildApp(cfg, memStore());
    for (const payload of [{ type: "NOPE" }, { type: "START_AGENT", url: "http://x" }, { type: "REQUEST_APPROVAL" }]) {
      const r = await app.inject({ method: "POST", url: "/v1/agent/control", headers: auth, payload });
      expect(r.statusCode).toBe(400);
    }
  });

  it("fails closed when the database is down", async () => {
    const app = await buildApp(cfg, down);
    const r = await app.inject({ method: "POST", url: "/v1/agent/control", headers: auth, payload: { type: "START_AGENT" } });
    expect(r.statusCode).toBe(503);
    expect((await app.inject({ url: "/v1/agent/status", headers: auth })).statusCode).toBe(503);
    const h = (await app.inject({ url: "/v1/health" })).json();
    expect(h.degraded).toBe(true);
    expect(h.services.find((s: { name: string }) => s.name === "postgres").status).toBe("down");
    expect(h.services.find((s: { name: string }) => s.name === "ollama").status).toBe("unknown");
  });
});
