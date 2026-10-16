/** Typed contracts for the local Fastify API. Mirrors docs/API.md. */
import type { ControlSnapshot, ControlState } from "../control-machine";

export type ConnectionStatus = "mock" | "connecting" | "online" | "offline" | "error";

export interface ServiceHealth {
  name: "api" | "postgres" | "ollama" | "playwright" | "novnc" | "agent";
  status: "up" | "down" | "unknown";
  detail?: string;
}
export interface HealthResponse {
  version: string;
  services: ServiceHealth[];
  degraded?: boolean;
}

export interface AgentStatus {
  control: ControlState;
  currentTask: string | null;
  model: string | null;
  uptimeSec: number;
  /** Authoritative snapshot from the runtime (absent in mock mode). */
  snapshot?: ControlSnapshot;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  profileId: string;
  active: boolean;
}

export type BrowserTabAction =
  | { action: "new" }
  | { action: "activate"; tabId: string }
  | { action: "close"; tabId: string }
  | { action: "navigate"; tabId: string; url: string };

export type ChatMessageStatus = "complete" | "streaming" | "aborted" | "failed";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  seq?: number;
  status?: ChatMessageStatus;
  model?: string | null;
  error?: string | null;
}

export type TaskStatus = "queued" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled";
export interface AgentTask {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  // Only present for actual Phase 2E read-only review tasks.
  objective?: string;
  model?: string;
  tabId?: string;
  result?: string | null;
  error?: string | null;
  steps?: { at: string; phase: string; detail: string }[];
  finishedAt?: string | null;
}

export type KnowledgeCategory = "personal" | "instruction" | "style" | "example";
export interface KnowledgeVersion {
  version: number;
  title: string;
  body: string;
  at: string;
}
export interface KnowledgeItem {
  id: string;
  category: KnowledgeCategory;
  title: string;
  body: string;
  tags: string[];
  version: number;
  updatedAt: string;
  history: KnowledgeVersion[];
}

export interface BrowserAccount {
  id: string;
  domain?: string;
  canReview?: boolean;
  canExternalWrite?: false;
  platform: "facebook" | "whatsapp" | "instagram" | "other";
  label: string;
  profileId: string;
  session: "unknown" | "logged_in" | "logged_out" | "expired";
  lastCheckedAt: string | null;
  canAgentControl: boolean;
}

export interface ScheduledTask {
  id: string;
  title: string;
  cron: string;
  enabled: boolean;
  nextRunAt: string | null;
  requiresApproval: boolean;
}

export type ApprovalKind = "external_message" | "publish_comment" | "project_change" | "other";
export interface ApprovalDraft {
  kind: ApprovalKind;
  action: string;
  target: string;
  preview: string;
}
export interface ApprovalRequest extends ApprovalDraft {
  id: string;
  risk: "low" | "medium" | "high";
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string | null;
  payloadDigest?: string;
  // Human decision on a draft NEVER authorizes an automatic external send.
  executable?: false;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface ActivityLog {
  id: string;
  at: string;
  level: "info" | "warn" | "error" | "audit";
  actor: "user" | "agent" | "system";
  message: string;
}

export interface LocalNotification {
  id: string;
  taskId: string | null;
  kind: "task_done" | "task_failed" | "task_cancelled";
  message: string;
  createdAt: string;
  readAt: string | null;
}
