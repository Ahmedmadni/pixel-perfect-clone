/** Typed contracts for the local Fastify API. Mirrors docs/API.md. */
import type { ControlSnapshot, ControlState } from "../control-machine";

export type ConnectionStatus = "mock" | "connecting" | "online" | "offline" | "error";

export interface ServiceHealth {
  name: "api" | "postgres" | "ollama" | "playwright" | "novnc";
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

export type ChatMessageStatus = "complete" | "streaming" | "aborted" | "failed";
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  /** Present on runtime-persisted messages (Phase 2B). */
  seq?: number;
  status?: ChatMessageStatus;
  model?: string | null;
  error?: string | null;
}

export type TaskStatus = "queued" | "running" | "awaiting_approval" | "done" | "failed";
export interface AgentTask {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
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

export interface ApprovalRequest {
  id: string;
  action: string;
  target: string;
  preview: string;
  risk: "low" | "medium" | "high";
  createdAt: string;
  status: "pending" | "approved" | "rejected";
}

export interface ActivityLog {
  id: string;
  at: string;
  level: "info" | "warn" | "error" | "audit";
  actor: "user" | "agent" | "system";
  message: string;
}
