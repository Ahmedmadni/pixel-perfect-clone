import type { HealthResponse, ServiceHealth } from "./api/types";

export type ReadinessSeverity = "good" | "warning" | "error";
export type ReadinessCheck = {
  id: string;
  level: ReadinessSeverity;
  title: string;
  detail: string;
};

export type ReadinessInput = {
  mock: boolean;
  localOrigin: boolean;
  tokenPresent: boolean;
  health?: HealthResponse | null;
  healthError: boolean;
  auth: "pending" | "verified" | "rejected" | "unreachable";
  installedModels?: number | null;
};

function service(health: HealthResponse, name: ServiceHealth["name"]) {
  return health.services.find((s) => s.name === name)?.status ?? "unknown";
}

/** Pure, privacy-safe diagnoses: never accepts or prints a bearer token. */
export function evaluateLocalReadiness(input: ReadinessInput): ReadinessCheck[] {
  if (input.mock || !input.localOrigin) {
    return [{
      id: "hosted-preview", level: "warning",
      title: "هذه معاينة فقط، وليست المتصفح المحلي",
      detail: "افتح الواجهة على http://127.0.0.1:8080 بعد تشغيل launch.ps1 على الكمبيوتر. لا تدخل رمز الخادم في Lovable المستضاف.",
    }];
  }
  const result: ReadinessCheck[] = [];
  if (!input.health || input.healthError) {
    return [{
      id: "runtime-offline", level: "error",
      title: "خادم Fastify المحلي لا يستجيب",
      detail: "تأكد من تشغيل Docker Desktop ثم نفّذ .\\scripts\\windows\\launch.ps1 من مجلد المشروع. للفحص الآمن شغّل diagnose.ps1.",
    }];
  }

  if (service(input.health, "postgres") !== "up") {
    result.push({
      id: "database", level: "error", title: "PostgreSQL غير جاهز",
      detail: "تأكد من تشغيل Docker Desktop والحاوية المحلية، ثم شغّل diagnose.ps1. يحتاج النظام إلى الترحيلات السبع.",
    });
  }
  if (service(input.health, "playwright") !== "up") {
    result.push({
      id: "browser", level: "error", title: "Chromium غير جاهز",
      detail: "راجع Docker Desktop وتشغيل حاوية browser-worker. لا تعطّل Chromium Sandbox لتجاوز مشاكل الإقلاع.",
    });
  }
  if (service(input.health, "novnc") !== "up") {
    result.push({
      id: "viewer", level: "error", title: "نافذة عرض المتصفح noVNC غير متاحة",
      detail: "راجع الحاوية والمنفذ المحلي 127.0.0.1:6080. صلاحيات المساعد لا تعالج مشكلة العرض.",
    });
  }
  if (service(input.health, "ollama") !== "up") {
    result.push({
      id: "ollama", level: "error", title: "خدمة Ollama لا تستجيب",
      detail: "شغّل Ollama محليًا وتحقق من http://127.0.0.1:11434/api/tags على الكمبيوتر، ثم أعد الفحص.",
    });
  }

  if (!input.tokenPresent) {
    result.push({
      id: "token-missing", level: "warning", title: "لم يتم إدخال رمز الخادم لهذه الجلسة",
      detail: "الصق RUNTIME_TOKEN من runtime/.env على الكمبيوتر في الحقل الآمن بأسفل الصفحة. لا تشاركه مع أحد.",
    });
  } else if (input.auth === "rejected") {
    result.push({
      id: "token-rejected", level: "error", title: "الخادم رفض رمز الاتصال",
      detail: "استخدم الرمز الحالي داخل runtime/.env على جهازك، أو ألغِ التفويض القديم ثم احفظ الرمز الصحيح.",
    });
  } else if (input.auth === "unreachable") {
    result.push({
      id: "auth-unavailable", level: "warning", title: "لم يمكن التحقق من التفويض",
      detail: "الخدمة قد تكون بدأت للتو. أعد المحاولة بعد التحقق من تشغيل Fastify.",
    });
  }

  if (service(input.health, "ollama") === "up" && input.auth === "verified" &&
      input.installedModels === 0) {
    result.push({
      id: "model-missing", level: "warning", title: "لا يوجد نموذج ذكاء اصطناعي مثبت",
      detail: "اختر نموذجًا يناسب جهازك، مثل ollama pull llama3.2، ثم أعد التحقق. هذا التثبيت يتم محليًا.",
    });
  }
  if (service(input.health, "agent") !== "up" && result.every((x) => x.level !== "error") &&
      input.auth === "verified" && (input.installedModels ?? 0) > 0) {
    result.push({
      id: "agent-disabled", level: "warning", title: "التحكم الآلي غير مفعّل أو غير جاهز",
      detail: "صلاحية المراجعة مقفلة افتراضيًا. تحقق من إعدادات العامل المحلي، واستخدم مهام القراءة على تبويب HTTPS تختاره بنفسك.",
    });
  }

  if (result.length === 0 && input.auth === "verified" && service(input.health, "agent") === "up" &&
      (input.installedModels ?? 0) > 0) {
    return [{
      id: "ready", level: "good", title: "الخدمات المحلية جاهزة لبدء مهمة",
      detail: "حالة الخدمات مؤكدة، لكن لم يتم إثبات تسجيل الدخول لحسابات المواقع أو نجاح كل مهمة قبل تنفيذها.",
    }];
  }
  if (!result.length) {
    result.push({
      id: "checking", level: "warning", title: "بانتظار اكتمال التحقق",
      detail: "قد تحتاج خدمة Ollama أو اتصال الخادم إلى بضع ثوانٍ. اضغط تحديث الفحص بعد اكتمال التشغيل.",
    });
  }
  return result;
}
