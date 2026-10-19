/**
 * Disposable end-to-end Fastify/PostgreSQL/Ollama HTTP/browser gateway contract.
 * Requires TEST_DATABASE_URL pointing to an ISOLATED CI database.
 * The Ollama and browser HTTP endpoints are local test servers, not user accounts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import pg from "pg";
import { migrate } from "../src/migrate.ts";
import { PgControlStore } from "../src/store.ts";
import { PgChatStore } from "../src/chat-store.ts";
import { PgTaskRepository } from "../src/task-store.ts";
import { PgKnowledgeStore } from "../src/knowledge-store.ts";
import { PgPermissionRepository } from "../src/review-permissions.ts";
import { PgNotificationRepository } from "../src/notification-store.ts";
import { PgApprovalRepository } from "../src/approval-store.ts";
import { BrowserGateway } from "../src/browser-gateway.ts";
import { OllamaClient } from "../src/ollama.ts";
import { buildApp } from "../src/app.ts";
import type { FastifyInstance } from "fastify";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const token = "integrated-test-" + "f".repeat(48);
const workerToken = "worker-test-" + "a".repeat(48);
const headers = { authorization: `Bearer ${token}` };
const cfg = { RUNTIME_TOKEN: token, CORS_ORIGINS: ["http://localhost:8080"] };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
}

describe.skipIf(!databaseUrl)("full local stack contracts with actual PostgreSQL", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let ollamaServer: Server;
  let workerServer: Server;
  let workerMode = "STOPPED";

  beforeAll(async () => {
    await migrate(databaseUrl!);
    pool = new pg.Pool({ connectionString: databaseUrl!, max: 4 });
    // Ensure a clean control state without destroying any application data.
    await pool.query("UPDATE control_state SET state='MANUAL',reason=NULL WHERE id=1");
    ollamaServer = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags" && req.method === "GET") {
        res.end(JSON.stringify({ models: [{name:"ci-ollama-fixture",size:1000,details:{family:"test"}}] }));
      } else if (req.url === "/api/chat" && req.method === "POST") {
        for await (const _chunk of req) { /* consume request; all content stays in CI */ }
        res.setHeader("content-type", "application/x-ndjson");
        res.end('{"message":{"content":"تكامل محلي ناجح"},"done":false}\n{"done":true}\n');
      } else { res.statusCode = 404; res.end("{}"); }
    });
    const ollamaUrl = await listen(ollamaServer);

    workerServer = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== `Bearer ${workerToken}`) {
        res.statusCode = 401; return res.end('{"error":"unauthorized"}');
      }
      if (req.url === "/health") return res.end(JSON.stringify({
        ready:true,novnc:true,mode:workerMode,viewOnly:workerMode!=="MANUAL",
        tabs:1,agentRunnerReady:false,
      }));
      if (req.url === "/tabs") return res.end(JSON.stringify([{
        id:"b4aaf558-bf21-4c47-aabc-a54214ca27d5",
        title:"CI Test Tab",url:"about:blank",profileId:"ci",active:true,
      }]));
      if (req.url === "/control" && req.method === "POST") {
        let input = "";
        for await (const chunk of req) input += String(chunk);
        workerMode = JSON.parse(input).state;
        return res.end(JSON.stringify({ready:true,mode:workerMode,viewOnly:workerMode!=="MANUAL",
          novnc:true,agentRunnerReady:false,tabs:1}));
      }
      res.statusCode = 404; res.end('{"error":"unknown_route"}');
    });
    const workerUrl = await listen(workerServer);

    const control = new PgControlStore(pool);
    const browser = new BrowserGateway(workerUrl, workerToken);
    app = await buildApp(cfg, control, {
      browser, ollama: new OllamaClient(ollamaUrl),
      chat: new PgChatStore(pool),
      tasks: new PgTaskRepository(pool),
      knowledge: new PgKnowledgeStore(pool),
      permissions: new PgPermissionRepository(pool),
      notifications: new PgNotificationRepository(pool),
      approvals: new PgApprovalRepository(pool),
    });
  }, 20_000);

  afterAll(async () => {
    if (app) await app.close();
    if (workerServer) await close(workerServer);
    if (ollamaServer) await close(ollamaServer);
    if (pool) await pool.end();
  });

  it("detects real PostgreSQL, Ollama HTTP protocol and brokered browser", async () => {
    const health = await app.inject({ url:"/v1/health" });
    expect(health.statusCode).toBe(200);
    const services = health.json().services as {name:string;status:string}[];
    for (const name of ["postgres","ollama","playwright","novnc"]) {
      expect(services.find((s) => s.name === name)?.status).toBe("up");
    }
    expect(services.find((s) => s.name === "agent")?.status).toBe("down");
  });

  it("requires bearer token for real browser tabs and local Ollama model listing", async () => {
    expect((await app.inject({url:"/v1/browser/tabs"})).statusCode).toBe(401);
    const tabs = await app.inject({url:"/v1/browser/tabs",headers});
    expect(tabs.statusCode).toBe(200);
    expect(tabs.json()).toHaveLength(1);
    expect(tabs.json()[0].url).toBe("about:blank");
    const models = await app.inject({url:"/v1/models",headers});
    expect(models.statusCode).toBe(200);
    expect(models.json().models[0].name).toBe("ci-ollama-fixture");
  });

  it("streams from a loopback Ollama HTTP server and persists in actual PostgreSQL", async () => {
    const conversationId = "ci-integration-" + Date.now();
    const stream = await app.inject({
      url:"/v1/chat/stream",method:"POST",headers,
      payload:{conversationId,model:"ci-ollama-fixture",content:"تحقق من تكامل الخادم"},
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain("تكامل محلي ناجح");
    expect(stream.body).toContain('"type":"done"');
    const history = await app.inject({
      url:`/v1/chat/messages?conversationId=${conversationId}`,headers,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toHaveLength(2);
    expect(history.json().messages[1].status).toBe("complete");
  });

  it("refuses browser takeover without a user-started, permission-scoped review", async () => {
    const r = await app.inject({url:"/v1/agent/control",method:"POST",headers,
      payload:{type:"START_AGENT"}});
    expect(r.statusCode).toBe(409);
    expect(workerMode).toBe("STOPPED");
  });
});
