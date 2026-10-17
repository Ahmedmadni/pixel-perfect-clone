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
  LocalNotification,
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
      { name: "agent", status: "unknown" },
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
    {
      id: "k1", title: "تلخيص الرسائل غير المقروءة", status: "queued", createdAt: ago(18),
      objective: "[محاكاة] عرض خطوات تلخيص افتراضي دون فتح واتساب أو قراءة رسائل حقيقية",
    },
    {
      id: "k2", title: "الرد على تعليقات الصفحة", status: "awaiting_approval", createdAt: ago(60),
      objective: "[محاكاة] مسودة رد توضيحية فقط؛ لا يوجد نشر أو موافقة حقيقية",
      steps: [{at:ago(59),phase:"عرض تجريبي",detail:"تم إنشاء مثال ثابت لطلب موافقة؛ لا يوجد اتصال بمنصة خارجية"}],
    },
    {
      id: "k3", title: "أرشفة المحادثات القديمة", status: "done", createdAt: ago(300), finishedAt: ago(298),
      objective: "[محاكاة] استعراض شكل سجل مهمة مكتملة دون بيانات شخصية",
      result: "[محاكاة فقط] مثال على التقرير النهائي لمهمة مكتملة. لم تُفتح محادثات أو تُحفظ بيانات حسابات.",
      steps: [
        {at:ago(300),phase:"بدء المثال",detail:"بدء سيناريو واجهة افتراضي بالكامل"},
        {at:ago(299),phase:"المراجعة",detail:"معلومات عرض ثابتة وليست محتوى حسابات حقيقية"},
        {at:ago(298),phase:"الانتهاء",detail:"اكتمال نموذج الشرح داخل المعاينة فقط"},
      ],
    },
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
    {
      id: "r1", kind: "external_message", action: "مراجعة رسالة تجريبية",
      target: "واتساب — حساب افتراضي", preview: "[محاكاة] شكرًا لتواصلك، هذه مسودة غير حقيقية ولا تُرسل إلى أي شخص.",
      risk: "medium", createdAt: ago(5), expiresAt: ahead(55), status: "pending", executable: false,
    },
    {
      id: "r2", kind: "publish_comment", action: "مراجعة تعليق تجريبي",
      target: "فيسبوك — صفحة افتراضية", preview: "[محاكاة] يسعدنا استقبال استفسارك. هذا التعليق نص مثال فقط، ولا يوجد اتصال بفيسبوك.",
      risk: "high", createdAt: ago(20), expiresAt: ahead(40), status: "pending", executable: false,
    },
    {
      id: "r3", kind: "project_change", action: "مثال على مسودة معتمدة",
      target: "مشروع تجريبي", preview: "[محاكاة] سجل قرار عرض فقط؛ لم يحدث تغيير في أي مشروع.",
      risk: "high", createdAt: ago(120), decidedAt: ago(115), status: "approved", executable: false,
    },
    {
      id: "r4", kind: "other", action: "مثال على مسودة مرفوضة",
      target: "سيناريو وهمي", preview: "[محاكاة] مثال على حالة مرفوضة بلا أي أثر خارجي.",
      risk: "low", createdAt: ago(200), decidedAt: ago(190), status: "rejected", executable: false,
    },
    {
      id: "r5", kind: "external_message", action: "مثال على مسودة منتهية",
      target: "جهة افتراضية", preview: "[محاكاة] انتهى وقت مراجعة هذا المثال ولا يمكن اعتماده.",
      risk: "medium", createdAt: ago(260), expiresAt: ago(200), status: "expired", executable: false,
    },
  ],
  notifications: (): LocalNotification[] => [
    {
      id:"demo-notice-k3", taskId:"k3", kind:"task_done",
      message:"[محاكاة] انتهى مثال مهمة أرشفة محادثات افتراضية؛ لا توجد بيانات حقيقية.",
      createdAt:ago(296), readAt:null,
    },
  ],
  logs: (): ActivityLog[] => [
    { id: "l1", at: ago(1), level: "info", actor: "system", message: "تم تحميل الواجهة في الوضع التجريبي" },
    { id: "l2", at: ago(5), level: "audit", actor: "agent", message: "طلب موافقة: إرسال رسالة واتساب" },
    { id: "l3", at: ago(12), level: "warn", actor: "system", message: "خدمة Ollama غير متصلة" },
    { id: "l4", at: ago(30), level: "audit", actor: "user", message: "تم تغيير وضع التحكم إلى يدوي" },
    { id: "l5", at: ago(55), level: "error", actor: "system", message: "تعذر الوصول إلى noVNC على 127.0.0.1:6080" },
  ],
};
