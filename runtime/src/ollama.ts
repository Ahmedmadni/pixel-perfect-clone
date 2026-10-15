/**
 * Minimal client for Ollama's native HTTP API (/api/tags, /api/chat).
 * The base URL comes ONLY from validated config (loopback) — never from a request.
 */
export interface OllamaModel {
  name: string;
  size: number | null;
  modifiedAt: string | null;
  family: string | null;
  parameterSize: string | null;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OllamaError extends Error {
  constructor(
    message: string,
    public kind: "offline" | "timeout" | "http" | "bad_response" | "model_error",
  ) {
    super(message);
  }
}

/** Splits an NDJSON byte stream into parsed objects, tolerating chunks split anywhere (incl. inside UTF-8 sequences). */
export async function* parseNdjson(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        throw new OllamaError("Malformed NDJSON line from Ollama", "bad_response");
      }
    }
    if (buf.length > 1_000_000) throw new OllamaError("Ollama line too long", "bad_response");
  }
  buf += decoder.decode();
  const tail = buf.trim();
  if (tail) {
    try {
      yield JSON.parse(tail);
    } catch {
      throw new OllamaError("Truncated NDJSON from Ollama", "bad_response");
    }
  }
}

function linkSignals(timeoutMs: number, outer?: AbortSignal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new OllamaError("Ollama timed out", "timeout")), timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  outer?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctrl.signal,
    clear: () => {
      clearTimeout(t);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

function mapFetchError(e: unknown, signal: AbortSignal): never {
  if (e instanceof OllamaError) throw e;
  if (signal.aborted) {
    const r = signal.reason;
    if (r instanceof OllamaError) throw r;
    throw e; // caller-initiated abort: rethrow AbortError
  }
  throw new OllamaError("Ollama unreachable", "offline");
}

export class OllamaClient {
  constructor(
    private baseUrl: string,
    private opts: { tagsTimeoutMs?: number; idleTimeoutMs?: number; totalTimeoutMs?: number } = {},
  ) {}

  async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const l = linkSignals(this.opts.tagsTimeoutMs ?? 2500, signal);
    try {
      const res = await fetch(new URL("/api/tags", this.baseUrl), { signal: l.signal });
      if (!res.ok) throw new OllamaError(`Ollama /api/tags HTTP ${res.status}`, "http");
      const j = (await res.json()) as { models?: unknown };
      if (!Array.isArray(j.models)) throw new OllamaError("Unexpected /api/tags response", "bad_response");
      return j.models
        .filter((m): m is Record<string, unknown> => !!m && typeof (m as { name?: unknown }).name === "string")
        .map((m) => {
          const d = (m["details"] ?? {}) as Record<string, unknown>;
          return {
            name: String(m["name"]),
            size: typeof m["size"] === "number" ? m["size"] : null,
            modifiedAt: typeof m["modified_at"] === "string" ? m["modified_at"] : null,
            family: typeof d["family"] === "string" ? d["family"] : null,
            parameterSize: typeof d["parameter_size"] === "string" ? d["parameter_size"] : null,
          };
        });
    } catch (e) {
      mapFetchError(e, l.signal);
    } finally {
      l.clear();
    }
  }

  /** Streams assistant text deltas. Aborting `signal` cancels the upstream Ollama request. */
  async *chatStream(model: string, messages: OllamaChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
    const total = linkSignals(this.opts.totalTimeoutMs ?? 300_000, signal);
    const idleMs = this.opts.idleTimeoutMs ?? 60_000;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(new OllamaError("Ollama stopped responding", "timeout")), idleMs);
    };
    const onTotal = () => ctrl.abort(total.signal.reason);
    total.signal.addEventListener("abort", onTotal, { once: true });
    try {
      arm();
      let res: Response;
      try {
        res = await fetch(new URL("/api/chat", this.baseUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true }),
          signal: ctrl.signal,
        });
      } catch (e) {
        mapFetchError(e, ctrl.signal);
      }
      if (!res.ok || !res.body) {
        let detail = "";
        try {
          detail = String(((await res.json()) as { error?: unknown }).error ?? "");
        } catch {}
        throw new OllamaError(detail.slice(0, 200) || `Ollama /api/chat HTTP ${res.status}`, res.status === 404 ? "model_error" : "http");
      }
      try {
        for await (const obj of parseNdjson(res.body as unknown as AsyncIterable<Uint8Array>)) {
          arm();
          const o = obj as { error?: unknown; done?: unknown; message?: { content?: unknown } };
          if (typeof o.error === "string") throw new OllamaError(o.error.slice(0, 200), "model_error");
          const c = o.message?.content;
          if (typeof c === "string" && c) yield c;
          if (o.done === true) return;
        }
      } catch (e) {
        mapFetchError(e, ctrl.signal);
      }
      throw new OllamaError("Ollama stream ended without done", "bad_response");
    } finally {
      clearTimeout(idle);
      total.signal.removeEventListener("abort", onTotal);
      total.clear();
      ctrl.abort();
    }
  }
}