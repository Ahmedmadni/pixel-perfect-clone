/**
 * Local API client. Talks to the Fastify runtime on the user's machine.
 * In mock mode NOTHING is sent anywhere; responses come from ./mock and the
 * UI labels them as mock data. Mock mode is never presented as a real integration.
 */
import { mock } from "./mock";
import type { ControlEvent, ControlSnapshot } from "../control-machine";
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

function getToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("paw.token");
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
    const token = getToken();
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
  /** Sends the exact discriminated-union body the runtime validates: { type, reason?, error? }. */
  sendControl: (event: ControlEvent) =>
    request<{ ok: true; snapshot: ControlSnapshot }>("/v1/agent/control", post(event)),
  browserTabs: () => request<BrowserTab[]>("/v1/browser/tabs", undefined, mock.tabs),
  chatHistory: () => request<ChatMessage[]>("/v1/chat/messages", undefined, mock.chat),
  sendChat: (content: string) =>
    request<ChatMessage>("/v1/chat/messages", post({ content }), () => ({
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: "[وضع تجريبي] لا يوجد نموذج Ollama متصل. هذا رد وهمي.",
      at: new Date().toISOString(),
    })),
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
