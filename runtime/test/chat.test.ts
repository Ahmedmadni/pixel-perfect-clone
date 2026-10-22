import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { OllamaClient } from "../src/ollama.ts";
import type { ChatStore } from "../src/chat-store.ts";
import type { PgKnowledgeStore } from "../src/knowledge-store.ts";
import type { ControlStore } from "../src/store.ts";
import type { ChatMessage, ChatMessageStatus } from "../../src/lib/api/types.ts";
import { initialControl, nextState, type ControlSnapshot } from "../../src/lib/control-machine.ts";

const TOKEN = "q".repeat(64);
const cfg = { RUNTIME_TOKEN: TOKEN, CORS_ORIGINS: ["http://localhost:8080"] };
const headers = { authorization: `Bearer ${TOKEN}`, origin: "http://localhost:8080" };

afterEach(() => vi.unstubAllGlobals());

function control(): ControlStore {
  let snap: ControlSnapshot = initialControl;
  return {
    ping: async () => {},
    getSnapshot: async () => snap,
    apply: async (e) => {
      const state = nextState(snap.state, e.type);
      if (!state) return { ok: false, snapshot: snap };
      snap = { state, reason: null, history: [] };
      return { ok: true, snapshot: snap };
    },
    logs: async () => [],
  };
}

function history(): ChatStore {
  const messages: ChatMessage[] = [];
  const add = (role: ChatMessage["role"], content: string, status: ChatMessageStatus, model?: string): ChatMessage => {
    const msg: ChatMessage = { id: randomUUID(), role, content, status, at: new Date().toISOString(), seq: messages.length+1, model };
    messages.push(msg);
    return msg;
  };
  return {
    list: async (_conv, _limit) => ({ messages, nextBefore: null }),
    context: async () => messages.filter((m) => m.status === "complete"),
    addUser: async (_conv, content) => add("user", content, "complete"),
    startAssistant: async (_conv, model) => add("assistant", "", "streaming", model),
    finishAssistant: async (id, content, status, error) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg) throw new Error("Missing assistant message");
      msg.content = content;
      msg.status = status;
      msg.error = error ?? null;
      return msg;
    },
    recover: async () => {},
  };
}

describe("Phase 2B chat API", () => {
  it("rejects unauthenticated requests to the model list", async () => {
    const app = await buildApp(cfg, control(), { ollama: new OllamaClient("http://127.0.0.1:11434"), chat: history() });
    const response = await app.inject({ url: "/v1/models" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("reports locally installed models without cloud APIs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "test-local" }] }))));
    const app = await buildApp(cfg, control(), { ollama: new OllamaClient("http://127.0.0.1:11434"), chat: history() });
    const response = await app.inject({ url: "/v1/models", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().models[0].name).toBe("test-local");
    await app.close();
  });

  it("rejects a model that has not been installed before persisting anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "installed" }] }))));
    const chat = history();
    const app = await buildApp(cfg, control(), { ollama: new OllamaClient("http://127.0.0.1:11434"), chat });
    const response = await app.inject({
      method: "POST", url: "/v1/chat/stream", headers,
      payload: { model: "other", content: "Hello", conversationId: "default" },
    });
    expect(response.statusCode).toBe(400);
    expect((await chat.list("default", 20)).messages).toHaveLength(0);
    await app.close();
  });

  it("streams assistant deltas and records a complete conversation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "installed" }] }));
      return new Response('{"message":{"content":"أهلاً"},"done":false}\n{"done":true}\n');
    }));
    const chat = history();
    const app = await buildApp(cfg, control(), { ollama: new OllamaClient("http://127.0.0.1:11434"), chat });
    const response = await app.inject({
      method: "POST", url: "/v1/chat/stream", headers,
      payload: { model: "installed", content: "مرحبا", conversationId: "default" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"type":"delta"');
    expect(response.body).toContain('"type":"done"');
    const saved = (await chat.list("default", 20)).messages;
    expect(saved).toHaveLength(2);
    expect(saved[1]?.status).toBe("complete");
    expect(saved[1]?.content).toBe("أهلاً");
    await app.close();
  });
  it("supplies local user-approved reply style to Ollama without cloud storage", async () => {
    let sentMessages: { role: string; content: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/api/tags")) return new Response(JSON.stringify({models: [{name: "installed"}]}));
      const posted = JSON.parse(String(init?.body)) as {messages: {role: string; content: string}[]};
      sentMessages = posted.messages;
      return new Response('{"message":{"content":"أهلاً بك"},"done":false}\n{"done":true}\n');
    }));
    const knowledge = {
      forPrompt: async () => [{ category: "style", title: "أسلوبي المعتمد", body: "ردود قصيرة وواضحة ومهنية", tags: ["العمل"] }],
    } as unknown as PgKnowledgeStore;
    const app = await buildApp(cfg, control(), {
      ollama: new OllamaClient("http://127.0.0.1:11434"), chat: history(), knowledge,
    });
    const res = await app.inject({
      method: "POST", url: "/v1/chat/stream", headers,
      payload: { model: "installed", content: "رد على العميل", conversationId: "default" },
    });
    expect(res.statusCode).toBe(200);
    expect(sentMessages[0]?.role).toBe("system");
    expect(sentMessages[0]?.content).toContain("أسلوبي المعتمد");
    expect(sentMessages.at(-1)?.content).toBe("رد على العميل");
    await app.close();
  });

});
