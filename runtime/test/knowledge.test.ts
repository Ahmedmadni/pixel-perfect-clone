import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { KnowledgeConflictError, type PgKnowledgeStore } from "../src/knowledge-store.ts";
import type { ControlStore } from "../src/store.ts";
import type { KnowledgeItem } from "../../src/lib/api/types.ts";
import { initialControl, type ControlSnapshot } from "../../src/lib/control-machine.ts";

const TOKEN = "k".repeat(64);
const cfg = { RUNTIME_TOKEN: TOKEN, CORS_ORIGINS: ["http://localhost:8080"] };
const auth = { authorization: `Bearer ${TOKEN}` };
const sample = { category: "style" as const, title: "الأسلوب المهني", body: "مرحبًا، كيف يمكنني مساعدتك؟", tags: ["عمل"] };

function controls(): ControlStore {
  return {
    ping: async () => {},
    getSnapshot: async (): Promise<ControlSnapshot> => initialControl,
    apply: async () => ({ ok: false, snapshot: initialControl }),
    logs: async () => [],
  };
}

function knowledge(): PgKnowledgeStore {
  let entries: KnowledgeItem[] = [];
  const get = (id: string) => entries.find((e) => e.id === id)!;
  return {
    list: async () => entries,
    create: async (d: typeof sample) => {
      const at = new Date().toISOString();
      const item: KnowledgeItem = { ...d, id: randomUUID(), version: 1, updatedAt: at, history: [{version: 1, title: d.title, body: d.body, at}] };
      entries = [item, ...entries];
      return item;
    },
    update: async (id: string, d: typeof sample, version: number) => {
      const prior = get(id);
      if (prior.version !== version) throw new KnowledgeConflictError();
      const at = new Date().toISOString();
      const next = { ...prior, ...d, version: version + 1, updatedAt: at, history: [{version: version + 1, title: d.title, body: d.body, at}, ...prior.history] };
      entries = entries.map((e) => e.id === id ? next : e);
      return next;
    },
    restore: async (id: string, version: number, expectedVersion: number) => {
      const prior = get(id);
      if (prior.version !== expectedVersion) throw new KnowledgeConflictError();
      const earlier = prior.history.find((e) => e.version === version)!;
      const next = { ...prior, title: earlier.title, body: earlier.body, version: prior.version + 1 };
      entries = entries.map((e) => e.id === id ? next : e);
      return next;
    },
    remove: async (id: string) => { entries = entries.filter((e) => e.id !== id); return { ok: true }; },
  } as unknown as PgKnowledgeStore;
}

describe("Phase 2D knowledge API contracts", () => {
  it("refuses knowledge reads without a local bearer token", async () => {
    const app = await buildApp(cfg, controls(), { knowledge: knowledge() });
    expect((await app.inject({ url: "/v1/knowledge" })).statusCode).toBe(401);
    await app.close();
  });
  it("requires a real knowledge store rather than returning fake entries", async () => {
    const app = await buildApp(cfg, controls());
    expect((await app.inject({ url: "/v1/knowledge", headers: auth })).statusCode).toBe(503);
    await app.close();
  });
  it("creates, updates with expected version, restores and deletes locally", async () => {
    const app = await buildApp(cfg, controls(), { knowledge: knowledge() });
    const created = await app.inject({ url: "/v1/knowledge", method: "POST", headers: auth, payload: sample });
    expect(created.statusCode).toBe(201);
    const item = created.json() as KnowledgeItem;
    expect(item.category).toBe("style");
    expect(item.history).toHaveLength(1);
    const updated = await app.inject({ url: `/v1/knowledge/${item.id}`, method: "PUT", headers: auth,
      payload: { ...sample, title: "رد احترافي", expectedVersion: 1 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);
    const conflict = await app.inject({ url: `/v1/knowledge/${item.id}`, method: "PUT", headers: auth,
      payload: { ...sample, expectedVersion: 1 } });
    expect(conflict.statusCode).toBe(409);
    const restored = await app.inject({ url: `/v1/knowledge/${item.id}/restore`, method: "POST", headers: auth,
      payload: { version: 1, expectedVersion: 2 } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().title).toBe(sample.title);
    const removed = await app.inject({ url: `/v1/knowledge/${item.id}`, method: "DELETE", headers: auth });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/knowledge", headers: auth })).json()).toHaveLength(0);
    await app.close();
  });
  it("validates category, body and tag input lengths", async () => {
    const app = await buildApp(cfg, controls(), { knowledge: knowledge() });
    for (const payload of [
      { ...sample, category: "secret_unknown" },
      { ...sample, title: "" },
      { ...sample, tags: ["x".repeat(80)] },
      { ...sample, unrecognized: true },
    ]) {
      const result = await app.inject({ url: "/v1/knowledge", method: "POST", headers: auth, payload });
      expect(result.statusCode).toBe(400);
    }
    await app.close();
  });
});
