/** Explicitly labeled MOCK data. Built lazily (no module-scope time/random calls). */
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

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const ahead = (min: number) => new Date(Date.now() + min * 60000).toISOString();

export const mock = {
  health: (): HealthResponse => ({
    version: "mock-0.1.0",
    services: [
      { name: "api", status: "unknown", detail: "وضع تجريبي" },
      { name: "postgres", status: "unknown" },
      { name: "ollama", status: "unknown" },
      { name: "playwright", status: "unknown" },
      { name: "novnc", status: "unknown" },
    ],
  }),
  agentStatus: (): AgentStatus => ({
    control: "MANUAL",
    currentTask: null,
    model: "llama3.1:8b (mock)",
    uptimeSec: 0,
  }),
  tabs: (): BrowserTab[] => [
    { id: "t1", title: "WhatsApp Web", url: "https://web.whatsapp.com", profileId: "p-main", active: true },
    { id: "t2", title: "Facebook", url: "https://facebook.com", profileId: "p-main", active: false },
    { id: "t3", title: "Instagram", url: "https://instagram.com", profileId: "p-work", active: false },
  ],
  chat: (): ChatMessage[] => [
    { id: "m1", role: "system", content: "جلسة تجريبية — لا يوجد اتصال بنموذج محلي.", at: ago(20) },
    { id: "m2", role: "user", content: "لخّص لي الرسائل غير المقروءة في واتساب.", at: ago(18) },
    { id: "m3", role: "assistant", content: "[تجريبي] سأحتاج إلى تشغيل المتصفح المحلي أولاً.", at: ago(18) },
  ],
  tasks: (): AgentTask[] => [
    { id: "k1", title: "تلخيص الرسائل غير المقروءة", status: "queued", createdAt: ago(18) },
    { id: "k2", title: "الرد على تعليقات الصفحة", status: "awaiting_approval", createdAt: ago(60) },
    { id: "k3", title: "أرشفة المحادثات القديمة", status: "done", createdAt: ago(300) },
  ],
  accounts: (): BrowserAccount[] => [
    { id: "a1", platform: "whatsapp", label: "واتساب الشخصي", profileId: "p-main", session: "unknown", lastCheckedAt: null, canAgentControl: false },
    { id: "a2", platform: "facebook", label: "فيسبوك", profileId: "p-main", session: "unknown", lastCheckedAt: null, canAgentControl: false },
    { id: "a3", platform: "instagram", label: "إنستغرام العمل", profileId: "p-work", session: "unknown", lastCheckedAt: null, canAgentControl: false },
  ],
  schedules: (): ScheduledTask[] => [
    { id: "s1", title: "ملخص صباحي للرسائل", cron: "0 8 * * *", enabled: true, nextRunAt: ahead(600), requiresApproval: false },
    { id: "s2", title: "نشر تذكير أسبوعي", cron: "0 18 * * 4", enabled: false, nextRunAt: null, requiresApproval: true },
  ],
  approvals: (): ApprovalRequest[] => [
    { id: "r1", action: "إرسال رسالة", target: "واتساب — أحمد", preview: "شكراً لك، سأراجع الملف وأرد عليك غداً.", risk: "medium", createdAt: ago(5), status: "pending" },
    { id: "r2", action: "نشر تعليق", target: "فيسبوك — منشور الصفحة", preview: "نسعد بخدمتكم دائماً 🌿", risk: "high", createdAt: ago(42), status: "pending" },
  ],
  logs: (): ActivityLog[] => [
    { id: "l1", at: ago(1), level: "info", actor: "system", message: "تم تحميل الواجهة في الوضع التجريبي" },
    { id: "l2", at: ago(5), level: "audit", actor: "agent", message: "طلب موافقة: إرسال رسالة واتساب" },
    { id: "l3", at: ago(12), level: "warn", actor: "system", message: "خدمة Ollama غير متصلة" },
    { id: "l4", at: ago(30), level: "audit", actor: "user", message: "تم تغيير وضع التحكم إلى يدوي" },
    { id: "l5", at: ago(55), level: "error", actor: "system", message: "تعذر الوصول إلى noVNC على 127.0.0.1:6080" },
  ],
};
