/** Generates a random local bearer token and writes it into runtime/.env (gitignored). */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync(".env")) copyFileSync(".env.example", ".env");
const token = randomBytes(32).toString("hex");
const env = readFileSync(".env", "utf8");
const next = /^RUNTIME_TOKEN=.*$/m.test(env)
  ? env.replace(/^RUNTIME_TOKEN=.*$/m, `RUNTIME_TOKEN=${token}`)
  : `${env.trimEnd()}\nRUNTIME_TOKEN=${token}\n`;
writeFileSync(".env", next, { mode: 0o600 });
console.log("New token written to runtime/.env.");
console.log("Paste it ONCE into the app: الإعدادات → رمز الخادم المحلي");
console.log(token);
