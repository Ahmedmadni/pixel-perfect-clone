import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { StoreUnavailableError, type ControlStore } from "./store.ts";
import type { AgentStatus, HealthResponse } from "../../src/lib/api/types.ts";

export const VERSION = "0.2.0-phase2a";

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
): Promise<FastifyInstance> {
  const startedAt = Date.now();
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || cfg.CORS_ORIGINS.includes(origin)),
    methods: ["GET", "POST"],
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
    const notProbed = "not probed in Phase 2A";
    return {
      version: VERSION,
      degraded: pg.status !== "up",
      services: [
        { name: "api", status: "up" },
        pg,
        { name: "ollama", status: "unknown", detail: notProbed },
        { name: "playwright", status: "unknown", detail: notProbed },
        { name: "novnc", status: "unknown", detail: notProbed },
      ],
    };
  });

  app.get("/v1/agent/status", async (): Promise<AgentStatus> => {
    const snapshot = await store.getSnapshot();
    return {
      control: snapshot.state,
      currentTask: null,
      model: null,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      snapshot,
    };
  });

  app.post("/v1/agent/control", async (req, reply) => {
    const parsed = controlBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_event" });
    const r = await store.apply(parsed.data, "user");
    if (!r.ok) return reply.code(409).send({ error: "invalid_transition", snapshot: r.snapshot });
    return { ok: true, snapshot: r.snapshot };
  });

  app.get("/v1/logs", async (req, reply) => {
    const q = logsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    return store.logs(q.data.limit);
  });

  return app;
}
