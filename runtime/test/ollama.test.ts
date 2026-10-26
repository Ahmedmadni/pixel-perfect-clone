import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient, OllamaError, parseNdjson } from "../src/ollama.ts";

afterEach(() => vi.unstubAllGlobals());

describe("Ollama local client", () => {
  it("discovers installed model names from the native tags endpoint", async () => {
    const fetchMock = vi.fn(async (_input: unknown) => new Response(JSON.stringify({
      models: [{ name: "local-test:latest", size: 1024, details: { family: "llama", parameter_size: "1B" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const models = await new OllamaClient("http://127.0.0.1:11434").listModels();
    expect(models[0]?.name).toBe("local-test:latest");
    expect(models[0]?.family).toBe("llama");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/tags");
  });

  it("handles missing Ollama as offline rather than fabricating a model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("ECONNREFUSED"); }));
    await expect(new OllamaClient("http://127.0.0.1:11434").listModels()).rejects.toMatchObject({ kind: "offline" });
  });

  it("accepts NDJSON split through UTF-8 multibyte characters", async () => {
    const bytes = new TextEncoder().encode('{"message":{"content":"أهلاً"},"done":false}\n{"done":true}\n');
    const chunks = [bytes.slice(0, 26), bytes.slice(26, 31), bytes.slice(31)];
    async function* body() { for (const chunk of chunks) yield chunk; }
    const values: unknown[] = [];
    for await (const value of parseNdjson(body())) values.push(value);
    expect(values).toHaveLength(2);
    expect((values[0] as { message: { content: string } }).message.content).toBe("أهلاً");
  });

  it("streams real model deltas and stops on Ollama's done event", async () => {
    const json = [
      JSON.stringify({ message: { content: "Hello " }, done: false }),
      JSON.stringify({ message: { content: "world" }, done: false }),
      JSON.stringify({ done: true }),
    ].join("\n") + "\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(json, { status: 200 })));
    const chunks: string[] = [];
    for await (const piece of new OllamaClient("http://127.0.0.1:11434").chatStream(
      "local-test:latest", [{ role: "user", content: "Hi" }], new AbortController().signal,
    )) chunks.push(piece);
    expect(chunks.join("")).toBe("Hello world");
  });

  it("rejects model errors emitted in a stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"model not found"}\n', { status: 200 })));
    const chunks: string[] = [];
    await expect((async () => {
      for await (const piece of new OllamaClient("http://127.0.0.1:11434").chatStream(
        "missing", [{ role: "user", content: "Hi" }], new AbortController().signal,
      )) chunks.push(piece);
    })()).rejects.toBeInstanceOf(OllamaError);
    expect(chunks).toHaveLength(0);
  });
  it("does not send requests for an already cancelled stream", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Cancelled"));
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response('{"done":true}\n');
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect((async () => {
      for await (const _delta of new OllamaClient("http://127.0.0.1:11434").chatStream("installed", [], controller.signal)) { /* none */ }
    })()).rejects.toThrow("Cancelled");
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it("rejects oversized complete NDJSON lines", async () => {
    async function* body() { yield new TextEncoder().encode(JSON.stringify({ content: "x".repeat(1_000_001) }) + "\n"); }
    await expect((async () => {
      for await (const _value of parseNdjson(body())) { /* none */ }
    })()).rejects.toMatchObject({ kind: "bad_response" });
  });
  it("blocks redirects for both discovery and inference", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return new Response('{"done":true}\n');
      return new Response('{"models":[]}');
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OllamaClient("http://127.0.0.1:11434");
    await client.listModels();
    for await (const _delta of client.chatStream("installed", [], new AbortController().signal)) { /* none */ }
    expect(fetchMock.mock.calls.map((call) => call[1]?.redirect)).toEqual(["error", "error"]);
  });
});
