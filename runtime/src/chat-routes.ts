import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OllamaClient, OllamaError } from "./ollama.ts";
import type { ChatStore } from "./chat-store.ts";
import type { PgKnowledgeStore } from "./knowledge-store.ts";

const conversationIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("default");
const bodySchema = z.object({
  content: z.string().trim().min(1).max(12000),
  model: z.string().trim().min(1).max(200),
  conversationId: conversationIdSchema,
}).strict();
const historyQuery = z.object({
  conversationId: conversationIdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
const cancelSchema = z.object({ conversationId: conversationIdSchema }).strict();

function describe(e: unknown): string {
  if (e instanceof OllamaError) {
    const messages = {
      offline: "Local Ollama is unreachable", timeout: "Local Ollama timed out",
      http: "Local Ollama returned an HTTP error", bad_response: "Local Ollama returned an invalid response",
      model_error: "Local Ollama model generation failed",
    };
    return messages[e.kind];
  }
  return "Chat generation or persistence failed";
}

export function registerChatRoutes(app: FastifyInstance, ollama?: OllamaClient, chat?: ChatStore, knowledge?: PgKnowledgeStore) {
  const active = new Map<string, AbortController>();
  app.addHook("preClose", async () => {
    for (const controller of active.values()) controller.abort();
  });

  app.get("/v1/models", async (_request, reply) => {
    if (!ollama) return reply.code(503).send({ error: "ollama_not_configured" });
    try {
      return { models: await ollama.listModels() };
    } catch (error) {
      return reply.code(503).send({ error: "ollama_unavailable", detail: describe(error) });
    }
  });

  app.get("/v1/chat/messages", async (request, reply) => {
    const q = historyQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    if (!chat) return reply.code(503).send({ error: "chat_not_configured" });
    return chat.list(q.data.conversationId, q.data.limit, q.data.before);
  });

  app.post("/v1/chat/cancel", async (request, reply) => {
    const parsed = cancelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_cancel_request" });
    const controller = active.get(parsed.data.conversationId);
    if (!controller) return reply.code(409).send({ error: "conversation_not_active" });
    controller.abort(new Error("Generation cancelled"));
    return reply.code(202).send({ ok: true, cancelling: true });
  });

  app.post("/v1/chat/stream", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_chat_request" });
    if (!ollama) return reply.code(503).send({ error: "ollama_not_configured" });
    if (!chat) return reply.code(503).send({ error: "chat_not_configured" });
    const { content, model, conversationId } = parsed.data;
    if (active.has(conversationId)) {
      return reply.code(409).send({ error: "conversation_busy" });
    }

    const controller = new AbortController();
    active.set(conversationId, controller);
    let assistantId: string | undefined;
    let answer = "";
    let completed = false;
    let disconnected = false;
    const onClose = () => {
      if (reply.raw.writableEnded) return;
      disconnected = true;
      controller.abort(new Error("Client disconnected"));
    };
    // A disconnected HTTP client may close the underlying socket before Fastify's
    // response lifecycle emits "close" (notably after hijacking for NDJSON).
    // Observe both signals so an upstream Ollama generation is cancelled promptly.
    const clientSocket = request.raw.socket;
    reply.raw.once("close", onClose);
    clientSocket.once("close", onClose);
    request.raw.once("aborted", onClose);
    try {
      // Reserve before discovery: concurrent requests cannot both pass preparation.
      let models;
      try { models = await ollama.listModels(controller.signal); }
      catch (error) {
        return reply.code(503).send({ error: "ollama_unavailable", detail: describe(error) });
      }
      if (!models.some((m) => m.name === model)) {
        return reply.code(400).send({ error: "model_not_installed" });
      }
      controller.signal.throwIfAborted();
      const context = await chat.context(conversationId, 30);
      const relevantKnowledge = knowledge ? await knowledge.forPrompt(content, 12) : [];
      const memoryText = relevantKnowledge.map((entry) => `[${entry.category}] ${entry.title}: ${entry.body}`).join("\n").slice(0, 7000);
      controller.signal.throwIfAborted();
      const user = await chat.addUser(conversationId, content);
      const assistant = await chat.startAssistant(conversationId, model);
      assistantId = assistant.id;

      reply.hijack();
      const trustedOrigin = request.headers.origin;
      reply.raw.writeHead(200, {
        ...(trustedOrigin ? { "Access-Control-Allow-Origin": trustedOrigin, "Vary": "Origin" } : {}),
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
      });
      const send = (event: object) => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(JSON.stringify(event) + "\n");
      };
      send({ type: "user", message: user });
      send({ type: "assistant_start", message: assistant });

      try {
        controller.signal.throwIfAborted();
        const messages = [
          ...(memoryText ? [{ role: "system" as const, content: "These are locally saved, user-authored preferences and context. Use only when relevant; do not disclose private details unnecessarily or imply that any external action was executed.\n" + memoryText }] : []),
          ...context.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content },
        ];
        for await (const delta of ollama.chatStream(model, messages, controller.signal)) {
          controller.signal.throwIfAborted();
          if (answer.length + delta.length > 1_000_000) throw new OllamaError("Answer too long", "bad_response");
          answer += delta;
          send({ type: "delta", text: delta });
        }
        controller.signal.throwIfAborted();
        const done = await chat.finishAssistant(assistant.id, answer, "complete");
        completed = true;
        send({ type: "done", message: done });
      } catch (error) {
        const aborted = controller.signal.aborted;
        await chat.finishAssistant(assistant.id, answer, aborted ? "aborted" : "failed", describe(error))
          .catch(() => {});
        if (!disconnected) send({ type: "error", error: aborted ? "Generation cancelled" : describe(error) });
      }
      if (!reply.raw.destroyed) reply.raw.end();
    } finally {
      reply.raw.removeListener("close", onClose);
      clientSocket.removeListener("close", onClose);
      request.raw.removeListener("aborted", onClose);
      // If a failure happened before attaching the stream, the error handler responds normally.
      if (assistantId && !completed && !reply.sent) {
        await chat.finishAssistant(assistantId, answer, controller.signal.aborted ? "aborted" : "failed", "Interrupted before streaming")
          .catch(() => {});
      }
      active.delete(conversationId);
    }
  });
}
