/**
 * Hosted preview = REAL empty state. Never invent tabs, accounts, tasks,
 * notifications, messages or model answers. The local runtime is authoritative.
 */
import type {
  ActivityLog, AgentStatus, AgentTask, ApprovalRequest, BrowserAccount,
  BrowserTab, ChatMessage, HealthResponse, LocalNotification, ScheduledTask,
} from "./types";

export const mock = {
  health: (): HealthResponse => ({
    version: "preview-not-connected",
    degraded: true,
    services: (["api", "postgres", "ollama", "playwright", "novnc", "agent"] as const)
      .map((name) => ({name, status: "unknown" as const, detail: "لم يتم الاتصال بخدمة محلية"})),
  }),
  agentStatus: (): AgentStatus => ({
    control: "STOPPED", currentTask: null, model: null, uptimeSec: 0,
  }),
  tabs: (): BrowserTab[] => [],
  chat: (): ChatMessage[] => [],
  tasks: (): AgentTask[] => [],
  accounts: (): BrowserAccount[] => [],
  schedules: (): ScheduledTask[] => [],
  approvals: (): ApprovalRequest[] => [],
  notifications: (): LocalNotification[] => [],
  logs: (): ActivityLog[] => [],
};
