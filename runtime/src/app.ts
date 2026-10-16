import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { StoreUnavailableError, type ControlStore } from "./store.ts";
import type { AgentStatus, HealthResponse } from "../../src/lib/api/types.ts";
import type { OllamaClient } from "./ollama.ts";
import type { ChatStore } from "./chat-store.ts";
import { registerChatRoutes } from "./chat-routes.ts";
import { BrowserGateway } from "./browser-gateway.ts";
import { nextState, type ControlEvent } from "../../src/lib/control-machine.ts";
import { KnowledgeConflictError, KnowledgeNotFoundError, type PgKnowledgeStore } from "./knowledge-store.ts";
import type { TaskRepository } from "./task-store.ts";
import type { NotificationRepository } from "./notification-store.ts";
import { AgentBusyError, AgentNotReadyError, ReadOnlyAgent } from "./read-only-agent.ts";

export const VERSION = "0.4.1-notifications";

const controlBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START_AGENT") }).strict(),
  z.object({ type: z.literal("REQUEST_APPROVAL"), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("APPROVE") }).strict(),
  z.object({ type: z.literal("REJECT") }).strict(),
  z.object({ type: z.literal("PAUSE") }).strict(),
  z.object({ type: z.literal("RESUME") }).strict(),
  z.object({ type: z.literal("TAKE_OVER") }).strict(),
  z.object({ type: z.literal("EMERGENCY_STOP") }).strict(),
  z.object({ type: z.literal("FAIL"), error: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("RESET") }).strict(),
]);
const logsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();

function tokenOk(header: string | undefined, token: string) {
  if (!header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildApp(
  cfg: Pick<Config, "RUNTIME_TOKEN" | "CORS_ORIGINS">,
  store: ControlStore,
  dependencies?: { ollama?: OllamaClient; chat?: ChatStore; browserReady?: () => boolean; browser?: BrowserGateway; knowledge?: PgKnowledgeStore; tasks?: TaskRepository; notifications?: NotificationRepository },
): Promise<FastifyInstance> {
  const startedAt = Date.now();
  let controlQueue: Promise<unknown> = Promise.resolve();
  function serializeControl<T>(fn: () => Promise<T>): Promise<T> {
    const next = controlQueue.then(fn);
    controlQueue = next.catch(() => {});
    return next;
  }
  const agent = dependencies?.browser && dependencies.ollama && dependencies.tasks
    ? new ReadOnlyAgent(store, dependencies.browser, dependencies.ollama, dependencies.tasks, serializeControl)
    : null;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || cfg.CORS_ORIGINS.includes(origin)),
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Reject foreign origins outright (CORS alone does not stop the request executing).
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !cfg.CORS_ORIGINS.includes(origin)) {
      return reply.code(403).send({ error: "origin_not_allowed" });
    }
    if (req.method === "OPTIONS" || req.url === "/v1/health") return;
    if (!tokenOk(req.headers.authorization, cfg.RUNTIME_TOKEN)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AgentBusyError) return reply.code(409).send({ error: "agent_busy", detail: err.message });
    if (err instanceof AgentNotReadyError) return reply.code(503).send({ error: "agent_not_ready", detail: err.message });
    if (err instanceof KnowledgeNotFoundError) return reply.code(404).send({ error: "knowledge_not_found" });
    if (err instanceof KnowledgeConflictError) return reply.code(409).send({ error: "knowledge_version_conflict" });
    if (err instanceof StoreUnavailableError) {
      return reply.code(503).send({ error: "store_unavailable", detail: "PostgreSQL unreachable — control is fail-closed" });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status < 500 ? "bad_request" : "internal_error" });
  });

  app.get("/v1/health", async (): Promise<HealthResponse & { degraded: boolean }> => {
    let pg: HealthResponse["services"][number] = { name: "postgres", status: "up" };
    try {
      await store.ping();
    } catch (e) {
      pg = { name: "postgres", status: "down", detail: (e as Error).message.slice(0, 200) };
    }
    const notProbed = "not probed: integration not yet implemented";
    let ollamaHealth: HealthResponse["services"][number] = { name: "ollama", status: "unknown", detail: notProbed };
    if (dependencies?.ollama) {
      try {
        const models = await dependencies.ollama.listModels();
        ollamaHealth = { name: "ollama", status: "up", detail: `${models.length} model(s) installed` };
      } catch {
        ollamaHealth = { name: "ollama", status: "down", detail: "local Ollama not reachable" };
      }
    }
    let browserHealth: { ready: boolean; novnc: boolean; agentRunnerReady: boolean } | null = null;
    if (dependencies?.browser) {
      try { browserHealth = await dependencies.browser.health(); }
      catch { browserHealth = { ready: false, novnc: false, agentRunnerReady: false }; }
    }
    return {
      version: VERSION,
      degraded: pg.status !== "up" || ollamaHealth.status === "down" || (dependencies?.browser && !browserHealth?.ready) === true,
      services: [
        { name: "api", status: "up" },
        pg,
        ollamaHealth,
        dependencies?.browser ? { name: "playwright", status: browserHealth?.ready ? "up" : "down" } : { name: "playwright", status: "unknown", detail: notProbed },
        dependencies?.browser ? { name: "novnc", status: browserHealth?.novnc ? "up" : "down" } : { name: "novnc", status: "unknown", detail: notProbed },
        { name: "agent", status: agent ? ((browserHealth?.ready && browserHealth.agentRunnerReady && ollamaHealth.status === "up") ? "up" : "down") : "unknown", detail: agent ? "User-started read-only review runner; no posting or messaging" : "Read-only runner not configured" },
      ],
    };
  });

  app.get("/v1/agent/status", async (): Promise<AgentStatus> => {
    let snapshot = await store.getSnapshot();
    if (["AGENT_ACTIVE", "APPROVAL_REQUIRED", "PAUSED"].includes(snapshot.state) && dependencies?.browser) {
      try {
        const worker = await dependencies.browser.health();
        if (!worker.ready || worker.mode === "STOPPED" || (snapshot.state === "AGENT_ACTIVE" && !worker.agentRunnerReady)) throw new Error("browser worker disconnected");
      } catch {
        await store.apply({ type: "FAIL", error: "Browser worker was not reachable; execution stopped" }, "system");
        snapshot = await store.getSnapshot();
      }
    }
    return {
      control: snapshot.state,
      currentTask: agent?.activeTaskId() ?? null,
      model: null,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      snapshot,
    };
  });

  app.post("/v1/agent/control", async (req, reply) => {
    const parsed = controlBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_event" });
    const event = parsed.data as ControlEvent;
    const result = await serializeControl(async () => {
      const before = await store.getSnapshot();
      if (!nextState(before.state, event.type)) return { status: 409, body: { error: "invalid_transition", snapshot: before } };
      const agentStarts = ["START_AGENT", "APPROVE", "RESUME"].includes(event.type);
      // Control messages alone must NEVER acquire or resume AI browser ownership.
      // Only a task created by ReadOnlyAgent.start() may enter AGENT_ACTIVE.
      if (agent && agentStarts) {
        return { status: 409, body: { error: "start_review_task_instead" } };
      }
      if (["TAKE_OVER", "PAUSE", "EMERGENCY_STOP", "FAIL", "REJECT"].includes(event.type)) agent?.cancelActive();
      if (agentStarts && !dependencies?.browser && !dependencies?.browserReady?.()) {
        return { status: 503, body: { error: "browser_agent_not_ready" } };
      }
      if (dependencies?.browser) {
        const target = event.type === "EMERGENCY_STOP" || event.type === "FAIL" ? "STOPPED"
          : event.type === "PAUSE" || event.type === "REQUEST_APPROVAL" ? "PAUSED"
          : agentStarts ? "AGENT_ACTIVE" : "MANUAL";
        try {
          const health = await dependencies.browser.health();
          if (!health.ready || (agentStarts && (!health.novnc || !health.agentRunnerReady))) throw new Error("browser_agent_not_ready");
          // Worker starts fail-closed, while the DB can initially say MANUAL.
          if (target === "AGENT_ACTIVE" && health.mode === "STOPPED" && before.state === "MANUAL") {
            await dependencies.browser.handoff("MANUAL");
          }
          await dependencies.browser.handoff(target);
        } catch {
          // Emergency stop MUST still close out the database state if the worker is unreachable.
          if (event.type !== "EMERGENCY_STOP" && event.type !== "FAIL") {
            try { await dependencies.browser.handoff("STOPPED"); } catch { /* offline */ }
            return { status: 503, body: { error: "browser_worker_unavailable" } };
          }
        }
      }
      try {
        const transition = await store.apply(event, "user");
        if (!transition.ok) {
          if (dependencies?.browser) await dependencies.browser.handoff("STOPPED").catch(() => {});
          return { status: 409, body: { error: "invalid_transition", snapshot: transition.snapshot } };
        }
        return { status: 200, body: { ok: true, snapshot: transition.snapshot } };
      } catch (error) {
        if (dependencies?.browser) await dependencies.browser.handoff("STOPPED").catch(() => {});
        throw error;
      }
    });
    return reply.code(result.status).send(result.body);
  });

  // Phase 2E: user-authorized review of a single browser tab; strictly read-only.
  const taskBody = z.object({
    objective: z.string().trim().min(4).max(2000),
    tabId: z.string().uuid(),
    model: z.string().trim().min(1).max(200),
  }).strict();
  app.get("/v1/tasks", async (req, reply) => {
    if (!dependencies?.tasks) return reply.code(503).send({ error: "tasks_not_configured" });
    const query = z.object({limit: z.coerce.number().int().min(1).max(100).default(30)}).strict().safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    return dependencies.tasks.list(query.data.limit);
  });
  app.post("/v1/tasks", async (req, reply) => {
    if (!agent) return reply.code(503).send({ error: "agent_not_configured" });
    const body = taskBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_review_request" });
    const task = await serializeControl(() => agent.start(body.data));
    return reply.code(202).send(task);
  });
  app.get("/v1/tasks/:id", async (req, reply) => {
    if (!dependencies?.tasks) return reply.code(503).send({ error: "tasks_not_configured" });
    const params = z.object({id: z.string().uuid()}).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_task_id" });
    const task = await dependencies.tasks.get(params.data.id);
    if (!task) return reply.code(404).send({ error: "task_not_found" });
    return task;
  });
  app.post("/v1/tasks/:id/cancel", async (req, reply) => {
    if (!agent) return reply.code(503).send({ error: "agent_not_configured" });
    const params = z.object({id: z.string().uuid()}).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_task_id" });
    const cancelled = agent.cancel(params.data.id);
    if (!cancelled) return reply.code(409).send({ error: "task_not_active" });
    return reply.code(202).send({ ok: true, cancelling: true });
  });

  app.get("/v1/browser/tabs", async (_req, reply) => {
    if (!dependencies?.browser) return reply.code(503).send({ error: "browser_worker_not_configured" });
    try { return await dependencies.browser.tabs(); }
    catch { return reply.code(503).send({ error: "browser_worker_unavailable" }); }
  });

  const tabAction = z.discriminatedUnion("action", [
    z.object({ action: z.literal("new") }).strict(),
    z.object({ action: z.literal("activate"), tabId: z.string().uuid() }).strict(),
    z.object({ action: z.literal("close"), tabId: z.string().uuid() }).strict(),
    z.object({ action: z.literal("navigate"), tabId: z.string().uuid(), url: z.string().max(2048) }).strict(),
  ]);
  app.post("/v1/browser/tabs", async (req, reply) => {
    if (!dependencies?.browser) return reply.code(503).send({ error: "browser_worker_not_configured" });
    const parsed = tabAction.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_tab_action" });
    if ((await store.getSnapshot()).state !== "MANUAL") return reply.code(409).send({ error: "manual_control_required" });
    try {
      await dependencies.browser.ensureManual();
      const action = parsed.data;
      if (action.action === "new") return await dependencies.browser.newTab();
      if (action.action === "activate") return await dependencies.browser.activateTab(action.tabId);
      if (action.action === "close") return await dependencies.browser.closeTab(action.tabId);
      return await dependencies.browser.navigate(action.tabId, action.url);
    } catch {
      return reply.code(503).send({ error: "browser_worker_unavailable_or_busy" });
    }
  });

  // Phase 2D: local-only persistent knowledge and reply styles.
  const knowledgeDraft = z.object({
    category: z.enum(["personal", "instruction", "style", "example"]),
    title: z.string().trim().min(1).max(250),
    body: z.string().max(12000),
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
  }).strict();
  const uuidParams = z.object({ id: z.string().uuid() });
  app.get("/v1/knowledge", async (_req, reply) => {
    if (!dependencies?.knowledge) return reply.code(503).send({ error: "knowledge_store_not_configured" });
    return dependencies.knowledge.list();
  });
  app.post("/v1/knowledge", async (req, reply) => {
    if (!dependencies?.knowledge) return reply.code(503).send({ error: "knowledge_store_not_configured" });
    const parsed = knowledgeDraft.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_knowledge" });
    return reply.code(201).send(await dependencies.knowledge.create(parsed.data));
  });
  app.put("/v1/knowledge/:id", async (req, reply) => {
    if (!dependencies?.knowledge) return reply.code(503).send({ error: "knowledge_store_not_configured" });
    const params = uuidParams.safeParse(req.params);
    const body = knowledgeDraft.extend({ expectedVersion: z.number().int().positive() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_knowledge_update" });
    const { expectedVersion, ...draft } = body.data;
    return dependencies.knowledge.update(params.data.id, draft, expectedVersion);
  });
  app.post("/v1/knowledge/:id/restore", async (req, reply) => {
    if (!dependencies?.knowledge) return reply.code(503).send({ error: "knowledge_store_not_configured" });
    const params = uuidParams.safeParse(req.params);
    const body = z.object({ version: z.number().int().positive(), expectedVersion: z.number().int().positive() }).strict().safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_knowledge_restore" });
    return dependencies.knowledge.restore(params.data.id, body.data.version, body.data.expectedVersion);
  });
  app.delete("/v1/knowledge/:id", async (req, reply) => {
    if (!dependencies?.knowledge) return reply.code(503).send({ error: "knowledge_store_not_configured" });
    const params = uuidParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_knowledge_id" });
    return dependencies.knowledge.remove(params.data.id);
  });

  // Phase 2F: private in-app notifications (no third-party messaging).
  app.get("/v1/notifications", async (req, reply) => {
    if (!dependencies?.notifications) return reply.code(503).send({ error: "notifications_not_configured" });
    const q = z.object({limit: z.coerce.number().int().min(1).max(100).default(50)}).strict().safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    return dependencies.notifications.list(q.data.limit);
  });
  app.post("/v1/notifications/:id/read", async (req, reply) => {
    if (!dependencies?.notifications) return reply.code(503).send({ error: "notifications_not_configured" });
    const p = z.object({id: z.string().uuid()}).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_notification_id" });
    const marked = await dependencies.notifications.markRead(p.data.id);
    if (!marked) return reply.code(404).send({ error: "notification_not_found" });
    return {ok: true};
  });

  app.get("/v1/logs", async (req, reply) => {
    const q = logsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    return store.logs(q.data.limit);
  });

  if (dependencies?.ollama && dependencies.chat) registerChatRoutes(app, dependencies.ollama, dependencies.chat, dependencies.knowledge);
  return app;
}
