import pg from "pg";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";
import { PgControlStore } from "./store.ts";
import { OllamaClient } from "./ollama.ts";
import { PgChatStore } from "./chat-store.ts";
import { BrowserGateway } from "./browser-gateway.ts";
import { PgKnowledgeStore } from "./knowledge-store.ts";
import { PgTaskRepository } from "./task-store.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();

const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 });
pool.on("error", (e) => console.error("[pg] idle client error:", e.message));

const chat = new PgChatStore(pool);
const tasks = new PgTaskRepository(pool);
await chat.recover();
await tasks.recover(); // Requires migration 002; never silently fall back to in-memory storage.
const browser = cfg.BROWSER_WORKER_TOKEN.length >= 32 ? new BrowserGateway(cfg.BROWSER_WORKER_URL, cfg.BROWSER_WORKER_TOKEN) : undefined;
const app = await buildApp(cfg, new PgControlStore(pool), { ollama: new OllamaClient(cfg.OLLAMA_URL), chat, knowledge: new PgKnowledgeStore(pool), tasks, ...(browser ? {browser} : {}) });
await app.listen({ host: cfg.RUNTIME_HOST, port: cfg.RUNTIME_PORT });
console.log(`PAW runtime listening on http://${cfg.RUNTIME_HOST}:${cfg.RUNTIME_PORT}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
