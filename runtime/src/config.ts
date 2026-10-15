import { z } from "zod";

const LOOPBACK = ["127.0.0.1", "::1", "localhost"];

const schema = z.object({
  RUNTIME_HOST: z
    .string()
    .default("127.0.0.1")
    .refine((h) => LOOPBACK.includes(h), "RUNTIME_HOST must be a loopback address"),
  RUNTIME_PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
  RUNTIME_TOKEN: z
    .string()
    .min(32, "RUNTIME_TOKEN missing or too short — run `npm run token`"),
  DATABASE_URL: z.string().url(),
  BROWSER_WORKER_TOKEN: z.string().default(""),
  BROWSER_WORKER_URL: z.string().url().default("http://127.0.0.1:4300").refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, "BROWSER_WORKER_URL must use a localhost HTTP origin"),
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434").refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, "OLLAMA_URL must be a trusted loopback HTTP URL"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:8080,http://127.0.0.1:8080")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .refine(
      (list) =>
        list.every((o) => {
          try {
            const u = new URL(o);
            return LOOPBACK.includes(u.hostname.replace(/^\[|\]$/g, ""));
          } catch {
            return false;
          }
        }),
      "CORS_ORIGINS may only contain localhost origins",
    ),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid runtime config:\n${msg}`);
  }
  return r.data;
}
