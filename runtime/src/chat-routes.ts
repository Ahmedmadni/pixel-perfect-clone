import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OllamaClient, OllamaError } from "./ollama.ts";
import type { ChatStore } from "./chat-store.ts";

const bodySchema = z.object({
  content: z.string().trim().min(1).max(12000),
  model: z.string().trim().min(1).max(200),
  conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("default"),
}).strict();
const historyQuery = z.object({
  conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("default"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
}).strict();

function describe(e: unknown): string {
  if (e instanceof OllamaError) return e.message.slice(0,200);
  return e instanceof Error ? e.message.slice(0,200) : "Unexpected error";
}

export function registerChatRoutes(app: FastifyInstance, ollama: OllamaClient, chat: ChatStore) {
  const active = new Map<string, AbortController>();
  app.addHook("onClose", async () => {
    for (const controller of active.values()) controller.abort();
    active.clear();
  });

  app.get("/v1/models", async (_request, reply) => {
    try {
      return { models: await ollama.listModels() };
    } catch (error) {
      return reply.code(503).send({ error: "ollama_unavailable", detail: describe(error) });
    }
  });

  app.get("/v1/chat/messages", async (request, reply) => {
    const q = historyQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    return chat.list(q.data.conversationId, q.data.limit, q.data.before);
  });

  app.post("/v1/chat/stream", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_chat_request" });
    const { content, model, conversationId } = parsed.data;
    if (active.has(conversationId)) {
      return reply.code(409).send({ error: "conversation_busy" });
    }

    // Confirm the requested model exists, and fail before saving any messages.
    let models;
    try { models = await ollama.listModels(); }
    catch (error) { return reply.code(503).send({ error: "ollama_unavailable", detail: describe(error) }); }
    if (!models.some((m) => m.name === model)) {
      return reply.code(400).send({ error: "model_not_installed" });
    }

    const controller = new AbortController();
    active.set(conversationId, controller);
    let assistantId: string | undefined;
    let answer = "";
    let completed = false;
    let disconnected = false;
    try {
      const context = await chat.context(conversationId, 30);
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
      reply.raw.once("close", () => {
        disconnected = true;
        controller.abort(new Error("Client disconnected"));
      });
      send({ type: "user", message: user });
      send({ type: "assistant_start", message: assistant });

      try {
        const messages = [
          ...context.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content },
        ];
        for await (const delta of ollama.chatStream(model, messages, controller.signal)) {
          answer += delta;
          send({ type: "delta", text: delta });
        }
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
      active.delete(conversationId);
      // If a failure happened before attaching the stream, the error handler responds normally.
      if (assistantId && !completed && !controller.signal.aborted && !reply.sent) {
        await chat.finishAssistant(assistantId, answer, "failed", "Interrupted before streaming")
          .catch(() => {});
      }
    }
  });
}
