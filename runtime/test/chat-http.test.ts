import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { OllamaClient } from "../src/ollama.ts";
import { PgChatStore, type ChatStore } from "../src/chat-store.ts";
import { StoreUnavailableError, type ControlStore } from "../src/store.ts";
import { initialControl } from "../../src/lib/control-machine.ts";
import type { ChatMessage } from "../../src/lib/api/types.ts";
import type { Pool } from "pg";

const token = "http-test-" + "x".repeat(64);
const cfg = { RUNTIME_TOKEN: token, CORS_ORIGINS: ["http://localhost:8080"] };
const headers = { authorization: `Bearer ${token}`, origin: "http://localhost:8080" };
const payload = { model: "installed", content: "مرحبا", conversationId: "default" };
const control: ControlStore = {
  ping: async () => {}, getSnapshot: async () => initialControl,
  apply: async () => ({ ok: false, snapshot: initialControl }), logs: async () => [],
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function history() {
  const messages: ChatMessage[] = [];
  const add = (role: ChatMessage["role"], content: string, status: ChatMessage["status"], model?: string) => {
    const message: ChatMessage = { id: randomUUID(), seq: messages.length + 1, role, content, status, model, at: new Date().toISOString() };
    messages.push(message);
    return message;
  };
  const chat: ChatStore = {
    list: async () => ({ messages, nextBefore: null }), context: async () => [],
    addUser: async (_id, content) => add("user", content, "complete"),
    startAssistant: async (_id, model) => add("assistant", "", "streaming", model),
    finishAssistant: async (id, content, status, error) => {
      const message = messages.find((item) => item.id === id);
      if (!message) throw new Error("Missing message");
      Object.assign(message, { content, status, error });
      return message;
    }, recover: async () => {},
  };
  return { chat, messages };
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function bind(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server port");
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${address.port}`;
}
async function runtime(ollama?: OllamaClient, chat?: ChatStore, store = control) {
  const app = await buildApp(cfg, store, { ollama, chat });
  cleanups.push(async () => {
    app.server.closeAllConnections();
    await app.close();
  });
  return app;
}
async function fixture(options: { empty?: boolean; holdTags?: boolean; holdChat?: boolean; badChat?: boolean } = {}) {
  const tagsEntered = deferred<void>();
  const releaseTags = deferred<void>();
  const chatEntered = deferred<void>();
  const chatClosed = deferred<void>();
  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      tagsEntered.resolve();
      if (options.holdTags) await releaseTags.promise;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ models: options.empty ? [] : [{ name: "installed" }] }));
    }
    for await (const _chunk of req) { /* consume test-only content */ }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.once("close", () => chatClosed.resolve());
    if (options.badChat) return res.end('{"error":"private-upstream-detail"}\n');
    const bytes = Buffer.from('{"message":{"content":"أهلاً"},"done":false}\n');
    res.write(bytes.subarray(0, 26));
    res.write(bytes.subarray(26, 29));
    res.write(bytes.subarray(29));
    chatEntered.resolve();
    if (!options.holdChat) res.end('{"done":true}\n');
  });
  const url = await bind(server);
  return { url, server, tagsEntered, releaseTags, chatEntered, chatClosed };
}
function stream(app: FastifyInstance, conversationId = "default") {
  return app.inject({ method: "POST", url: "/v1/chat/stream", headers, payload: { ...payload, conversationId } });
}

describe("Ollama HTTP endpoints and exclusive cancellable chat", () => {
  it("discovers real HTTP models and persists a split UTF-8 stream", async () => {
    const f = await fixture();
    const h = history();
    const app = await runtime(new OllamaClient(f.url), h.chat);
    expect((await app.inject({ url: "/v1/models", headers })).json().models[0].name).toBe("installed");
    const response = await stream(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toContain('"type":"done"');
    expect(h.messages[1]?.content).toBe("أهلاً");
    expect(h.messages[1]?.status).toBe("complete");
    expect((await app.inject({ url: "/v1/chat/messages", headers })).json().messages).toHaveLength(2);
  });
  it("reports empty models truthfully and refuses to persist an unavailable model", async () => {
    const f = await fixture({ empty: true });
    const h = history();
    const app = await runtime(new OllamaClient(f.url), h.chat);
    expect((await app.inject({ url: "/v1/models", headers })).json()).toEqual({ models: [] });
    const health = (await app.inject({ url: "/v1/health" })).json();
    expect(health.services.find((s: { name: string }) => s.name === "ollama").status).toBe("up");
    expect(health.degraded).toBe(true);
    expect((await stream(app)).json().error).toBe("model_not_installed");
    expect(h.messages).toHaveLength(0);
  });
  it("probes offline Ollama separately from PostgreSQL", async () => {
    const f = await fixture();
    f.server.closeAllConnections();
    await new Promise<void>((resolve) => f.server.close(() => resolve()));
    const app = await runtime(new OllamaClient(f.url), history().chat);
    expect((await app.inject({ url: "/v1/models", headers })).statusCode).toBe(503);
    const health = (await app.inject({ url: "/v1/health" })).json();
    expect(health.services.find((s: { name: string }) => s.name === "postgres").status).toBe("up");
    expect(health.services.find((s: { name: string }) => s.name === "ollama").status).toBe("down");
    expect(health.degraded).toBe(true);
  });
  it("exposes authenticated configuration failures instead of 404 or fabricated history", async () => {
    const app = await runtime();
    expect((await app.inject({ url: "/v1/models", headers })).json().error).toBe("ollama_not_configured");
    expect((await app.inject({ url: "/v1/chat/messages", headers })).json().error).toBe("chat_not_configured");
    const health = (await app.inject({ url: "/v1/health" })).json();
    expect(health.services.find((s: { name: string }) => s.name === "ollama").status).toBe("unknown");
    expect(health.degraded).toBe(true);
  });
  it("reserves a conversation before model discovery finishes", async () => {
    const f = await fixture({ holdTags: true });
    const app = await runtime(new OllamaClient(f.url), history().chat);
    const first = stream(app).then((response) => response);
    await f.tagsEntered.promise;
    expect((await stream(app)).statusCode).toBe(409);
    f.releaseTags.resolve();
    expect((await first).statusCode).toBe(200);
    expect((await stream(app)).statusCode).toBe(200);
  });
  it("releases the conversation lock when the client disconnects during model discovery", async () => {
    const f = await fixture({ holdTags: true });
    const h = history();
    const app = await runtime(new OllamaClient(f.url), h.chat);
    const clientSocketClosed = deferred<void>();
    app.server.once("connection", (socket) => socket.once("close", () => clientSocketClosed.resolve()));
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = httpRequest(url + "/v1/chat/stream", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
    });
    client.on("error", () => {});
    client.end(JSON.stringify(payload));
    await f.tagsEntered.promise;
    client.destroy();
    await clientSocketClosed.promise;
    f.releaseTags.resolve();

    // The abandoned request must not persist a user/assistant message or leave
    // the conversation permanently busy while model discovery is unwinding.
    let response: Awaited<ReturnType<typeof stream>> | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      response = await stream(app);
      if (response.statusCode !== 409) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(response?.statusCode).toBe(200);
    expect(h.messages).toHaveLength(2);
    expect(h.messages[1]?.status).toBe("complete");
  });
  it("cancels upstream generation, stores aborted partial text and releases the lock", async () => {
    const f = await fixture({ holdChat: true });
    const h = history();
    const app = await runtime(new OllamaClient(f.url), h.chat);
    const first = stream(app).then((response) => response);
    await f.chatEntered.promise;
    const cancel = await app.inject({ method: "POST", url: "/v1/chat/cancel", headers, payload: { conversationId: "default" } });
    expect(cancel.statusCode).toBe(202);
    const response = await first;
    await f.chatClosed.promise;
    expect(response.body).toContain('"type":"error"');
    expect(response.body).not.toContain('"type":"done"');
    expect(h.messages[1]?.status).toBe("aborted");
    expect((await app.inject({ method: "POST", url: "/v1/chat/cancel", headers, payload: {} })).statusCode).toBe(409);
  });
  it("aborts Ollama when the real HTTP client disconnects", async () => {
    const f = await fixture({ holdChat: true });
    const h = history();
    const app = await runtime(new OllamaClient(f.url), h.chat);
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const firstChunk = deferred<void>();
    const client = httpRequest(url + "/v1/chat/stream", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
    });
    client.on("response", (response) => {
      response.once("data", () => firstChunk.resolve());
      response.on("error", () => {});
    });
    // Destroy the actual TCP client socket; AbortController on fetch can leave
    // undici's pooled connection open while the test's upstream is held forever.
    client.on("error", () => {});
    client.end(JSON.stringify(payload));
    await firstChunk.promise;
    await f.chatEntered.promise;
    client.destroy();
    await f.chatClosed.promise;
    await new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const poll = () => h.messages[1]?.status === "aborted" ? resolve() : ++attempts > 100 ? reject(new Error("Not aborted")) : setTimeout(poll, 10);
      poll();
    });
    expect(h.messages[1]?.status).toBe("aborted");
    expect((await app.inject({ method: "POST", url: "/v1/chat/cancel", headers, payload: {} })).statusCode).toBe(409);
  });
  it("records failed generations and redacts upstream detail", async () => {
    const f = await fixture({ badChat: true });
    const h = history();
    const app = await runtime(new OllamaClient(f.url), h.chat);
    const response = await stream(app);
    expect(response.body).toContain('"type":"error"');
    expect(response.body).not.toContain("private-upstream-detail");
    expect(h.messages[1]?.status).toBe("failed");
    expect((await stream(app)).statusCode).toBe(200);
  });
  it.each([
    ["GET", "/v1/models"], ["GET", "/v1/chat/messages"],
    ["POST", "/v1/chat/stream"], ["POST", "/v1/chat/cancel"],
  ] as const)("enforces auth and origin on %s %s", async (method, url) => {
    const app = await runtime();
    expect((await app.inject({ method, url, payload: method === "POST" ? payload : undefined })).statusCode).toBe(401);
    expect((await app.inject({ method, url, headers: { ...headers, origin: "https://foreign.example" }, payload: method === "POST" ? payload : undefined })).statusCode).toBe(403);
  });
  it.each([
    { ...payload, endpoint: "http://remote.example" }, { ...payload, content: " " },
    { ...payload, content: "x".repeat(12001) }, { ...payload, conversationId: "../default" },
  ])("rejects invalid stream payload %# before any persistence", async (body) => {
    const h = history();
    const app = await runtime(undefined, h.chat);
    expect((await app.inject({ method: "POST", url: "/v1/chat/stream", headers, payload: body })).statusCode).toBe(400);
    expect(h.messages).toHaveLength(0);
  });
  it.each(["limit=0", "limit=101", "before=0", "before=9007199254740992", "conversationId=../a", "unexpected=1"])("rejects invalid history query %s", async (query) => {
    const app = await runtime(undefined, history().chat);
    expect((await app.inject({ url: "/v1/chat/messages?" + query, headers })).statusCode).toBe(400);
  });
  it("passes valid pagination to the store and fails closed on database failure", async () => {
    const h = history();
    const calls: unknown[][] = [];
    h.chat.list = async (...args) => { calls.push(args); return { messages: [], nextBefore: 20 }; };
    const app = await runtime(undefined, h.chat);
    expect((await app.inject({ url: "/v1/chat/messages?conversationId=work&limit=2&before=25", headers })).json()).toEqual({ messages: [], nextBefore: 20 });
    expect(calls).toEqual([["work", 2, 25]]);
    h.chat.list = async () => { throw new StoreUnavailableError("secret connection string"); };
    const response = await app.inject({ url: "/v1/chat/messages", headers });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("secret connection string");
  });
  it("returns the oldest sequence cursor after reversing a PostgreSQL page", async () => {
    const rows = [5, 4, 3].map((seq) => ({ id: randomUUID(), seq: String(seq), role: "user", content: String(seq), status: "complete", model: null, error: null, created_at: new Date() }));
    const pool = { query: async () => ({ rows }) } as unknown as Pool;
    const page = await new PgChatStore(pool).list("work", 2);
    expect(page.messages.map((m) => m.seq)).toEqual([4, 5]);
    expect(page.nextBefore).toBe(4);
  });
});