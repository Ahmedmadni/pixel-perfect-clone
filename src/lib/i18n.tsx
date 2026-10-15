import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "ar" | "en";

const dict = {
  overview: { ar: "نظرة عامة", en: "Overview" },
  browser: { ar: "مساحة المتصفح", en: "Browser Workspace" },
  chat: { ar: "المحادثة والمهام", en: "Chat & Tasks" },
  knowledge: { ar: "المعرفة والذاكرة", en: "Knowledge & Memory" },
  styles: { ar: "أساليب الرد", en: "Reply Styles" },
  accounts: { ar: "الحسابات والجلسات", en: "Accounts & Sessions" },
  schedule: { ar: "المهام المجدولة", en: "Scheduled Tasks" },
  approvals: { ar: "الموافقات والتنبيهات", en: "Approvals" },
  reports: { ar: "التقارير والسجلات", en: "Reports & Logs" },
  settings: { ar: "إعدادات النظام", en: "Settings" },
  emergencyStop: { ar: "إيقاف طارئ", en: "Emergency stop" },
  mockMode: { ar: "وضع تجريبي — بيانات وهمية", en: "Mock mode — fake data" },
  appName: { ar: "مساحة العمل الذكية", en: "Personal AI Workspace" },
} as const;
export type DictKey = keyof typeof dict;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: DictKey) => string }>({
  lang: "ar",
  setLang: () => {},
  t: (k) => dict[k].ar,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("ar");
  useEffect(() => {
    const saved = window.localStorage.getItem("paw.lang");
    if (saved === "en") setLang("en");
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    window.localStorage.setItem("paw.lang", lang);
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t: (k) => dict[k][lang] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
