/**
 * Local API client. Talks to the Fastify runtime on the user's machine.
 * In mock mode NOTHING is sent anywhere; responses come from ./mock and the
 * UI labels them as mock data. Mock mode is never presented as a real integration.
 */
import { mock } from "./mock";
import type {
  ActivityLog,
  AgentStatus,
  AgentTask,
  ApprovalRequest,
  BrowserAccount,
  BrowserTab,
  ChatMessage,
  HealthResponse,
  ScheduledTask,
} from "./types";
import type { ControlEvent, ControlSnapshot } from "../control-machine";

export const API_BASE: string = import.meta.env["VITE_LOCAL_API_URL"] ?? "http://127.0.0.1:4100";
export const NOVNC_URL: string =
  import.meta.env["VITE_NOVNC_URL"] ?? "http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale";
/** Mock mode is ON unless explicitly disabled with VITE_MOCK_MODE=false. */
export const MOCK_MODE: boolean = import.meta.env["VITE_MOCK_MODE"] !== "false";

export class ApiError extends Error {
  constructor(
    message: string,
    public kind: "offline" | "http" | "timeout",
    public status?: number,
  ) {
    super(message);
  }
}

export function getLocalToken() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("paw.token");
}

/** Session-only storage: closing this browser session clears the local API secret. */
export function setLocalToken(value: string) {
  if (typeof window === "undefined") return;
  if (value.trim()) window.sessionStorage.setItem("paw.token", value.trim());
  else window.sessionStorage.removeItem("paw.token");
}

async function request<T>(path: string, init?: RequestInit, mockFn?: () => T): Promise<T> {
  if (MOCK_MODE) {
    if (!mockFn) throw new ApiError("Not available in mock mode", "http", 501);
    await new Promise((r) => setTimeout(r, 250));
    return structuredClone(mockFn());
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const token = getLocalToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, "http", res.status);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError")
      throw new ApiError("Request timed out", "timeout");
    throw new ApiError("Local runtime unreachable", "offline");
  } finally {
    clearTimeout(timer);
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => request<HealthResponse>("/v1/health", undefined, mock.health),
  agentStatus: () => request<AgentStatus>("/v1/agent/status", undefined, mock.agentStatus),
  sendControl: (event: ControlEvent) =>
    request<{ ok: true; snapshot?: ControlSnapshot }>("/v1/agent/control", post(event), () => ({ ok: true as const })),
  browserTabs: () => request<BrowserTab[]>("/v1/browser/tabs", undefined, mock.tabs),
  chatHistory: async () => (await request<{ messages: ChatMessage[]; nextBefore: number | null }>("/v1/chat/messages", undefined, () => ({ messages: mock.chat(), nextBefore: null }))).messages,
  models: () => request<{ models: { name: string; size: number | null; parameterSize: string | null }[] }>("/v1/models", undefined, () => ({ models: [] })),
  streamChat: (content: string, model: string, onEvent: (event: ChatStreamEvent) => void, signal: AbortSignal) => streamLocalChat(content, model, onEvent, signal),
  tasks: () => request<AgentTask[]>("/v1/tasks", undefined, mock.tasks),
  accounts: () => request<BrowserAccount[]>("/v1/accounts", undefined, mock.accounts),
  schedules: () => request<ScheduledTask[]>("/v1/schedules", undefined, mock.schedules),
  approvals: () => request<ApprovalRequest[]>("/v1/approvals", undefined, mock.approvals),
  decide: (id: string, decision: "approve" | "reject") =>
    request<{ ok: true }>(`/v1/approvals/${id}`, post({ decision }), () => ({
      ok: true as const,
    })),
  logs: () => request<ActivityLog[]>("/v1/logs", undefined, mock.logs),
};

export type ChatStreamEvent =
  | { type: "user" | "assistant_start" | "done"; message: ChatMessage }
  | { type: "delta"; text: string }
  | { type: "error"; error: string };

async function streamLocalChat(
  content: string, model: string, onEvent: (event: ChatStreamEvent) => void, signal: AbortSignal,
): Promise<void> {
  if (MOCK_MODE) {
    onEvent({ type: "error", error: "الوضع التجريبي — لا يوجد نموذج ذكاء اصطناعي متصل." });
    return;
  }
  const token = getLocalToken();
  if (!token) throw new ApiError("أدخل رمز الخادم المحلي من الإعدادات أولاً", "http", 401);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content, model, conversationId: "default" }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError("تعذر الوصول إلى Ollama عبر الخادم المحلي", "offline");
  }
  if (!response.ok) {
    let detail = "Chat request failed";
    try {
      const body = await response.json() as { error?: string; detail?: string };
      detail = body.detail ?? body.error ?? detail;
    } catch { /* response may not be JSON */ }
    throw new ApiError(detail, "http", response.status);
  }
  if (!response.body) throw new ApiError("الخادم لم يرسل بيانات المحادثة", "http");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const parseLine = (line: string) => {
    if (!line.trim()) return;
    let parsed: ChatStreamEvent;
    try { parsed = JSON.parse(line) as ChatStreamEvent; }
    catch { throw new ApiError("بيانات غير صالحة من الخادم المحلي", "http"); }
    if (parsed.type === "done") finished = true;
    if (parsed.type === "error") throw new ApiError(parsed.error, "http");
    onEvent(parsed);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000) throw new ApiError("استجابة المحادثة أكبر من الحد المسموح", "http");
      while (buffer.includes("\n")) {
        const at = buffer.indexOf("\n");
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        parseLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseLine(buffer);
    if (!finished && !signal.aborted) throw new ApiError("انتهى اتصال المحادثة قبل اكتمال الرد", "http");
  } finally {
    reader.releaseLock();
  }
}
