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
import { PgNotificationRepository } from "./notification-store.ts";
import { PgApprovalRepository } from "./approval-store.ts";
import { PgPermissionRepository } from "./review-permissions.ts";
import { establishSafeBrowserStartup } from "./startup-safety.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();

const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 });
pool.on("error", (e) => console.error("[pg] idle client error:", e.message));

const chat = new PgChatStore(pool);
const tasks = new PgTaskRepository(pool);
await chat.recover();
await tasks.recover();
const control = new PgControlStore(pool);
await control.getSnapshot(); // Recover any abandoned AGENT_ACTIVE/PAUSED session before listening.
let browser: BrowserGateway | undefined;
if (cfg.BROWSER_WORKER_TOKEN.length >= 32) {
  try {
    const candidate = new BrowserGateway(cfg.BROWSER_WORKER_URL, cfg.BROWSER_WORKER_TOKEN);
    await establishSafeBrowserStartup(control, candidate);
    browser = candidate;
  } catch (error) {
    // Fail closed: do not make a previously-controlled worker accessible through this API.
    // Ollama chat and local knowledge may still run without browser control.
    console.warn("[browser] ownership reset not verified; browser API disabled until runtime restart:", (error as Error).message);
  }
}
const app = await buildApp(cfg, control, { ollama: new OllamaClient(cfg.OLLAMA_URL), chat, knowledge: new PgKnowledgeStore(pool), tasks, notifications: new PgNotificationRepository(pool), approvals: new PgApprovalRepository(pool), permissions: new PgPermissionRepository(pool), ...(browser ? {browser} : {}) });
await app.listen({ host: cfg.RUNTIME_HOST, port: cfg.RUNTIME_PORT });
console.log(`PAW runtime listening on http://${cfg.RUNTIME_HOST}:${cfg.RUNTIME_PORT}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
