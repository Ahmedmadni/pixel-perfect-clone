import pg from "pg";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";
import { PgControlStore } from "./store.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();

const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 });
pool.on("error", (e) => console.error("[pg] idle client error:", e.message));

const app = await buildApp(cfg, new PgControlStore(pool));
await app.listen({ host: cfg.RUNTIME_HOST, port: cfg.RUNTIME_PORT });
console.log(`PAW runtime listening on http://${cfg.RUNTIME_HOST}:${cfg.RUNTIME_PORT}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
