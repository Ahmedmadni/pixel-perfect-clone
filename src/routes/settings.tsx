import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { API_BASE, MOCK_MODE, NOVNC_URL, getLocalToken, setLocalToken } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/settings")({
  head: pageHead("إعدادات النظام", "Local runtime endpoints, security posture and language."),
  component: SettingsPage,
});

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-3 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function SettingsPage() {
  const { lang, setLang } = useI18n();
  const [token, setToken] = useState("");
  const [tokenExists, setTokenExists] = useState(false);
  useEffect(() => setTokenExists(Boolean(getLocalToken())), []);
  function saveToken() {
    if (token.trim().length < 32) return;
    setLocalToken(token);
    setToken("");
    setTokenExists(true);
    window.dispatchEvent(new Event("paw-token-updated"));
  }
  function clearToken() {
    setLocalToken("");
    setToken("");
    setTokenExists(false);
    window.dispatchEvent(new Event("paw-token-updated"));
  }
  return (
    <>
      <PageHeader title="إعدادات النظام" desc="تُضبط عناوين الخدمات عبر ملف .env.local، ورمز الخادم من هذه الصفحة." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="الاتصال المحلي">
          <Row k="وضع البيانات" v={MOCK_MODE ? <Pill tone="warning">تجريبي (Mock)</Pill> : <Pill tone="neutral">محاولة الاتصال المحلي</Pill>} />
          <Row k="VITE_LOCAL_API_URL" v={<code dir="ltr" className="font-mono text-xs">{API_BASE}</code>} />
          <Row k="VITE_NOVNC_URL" v={<code dir="ltr" className="font-mono text-xs">{NOVNC_URL}</code>} />
        </Panel>
        <Panel title="الأمان">
          <Row k="الاستماع على" v={<code className="font-mono text-xs">127.0.0.1 فقط</code>} />
          <Row k="المصادقة" v={<Pill tone={tokenExists ? "success" : "warning"}>{tokenExists ? "رمز محفوظ للجلسة الحالية" : "لم يُدخل رمز الاتصال"}</Pill>} />
          <Row k="صلاحيات التحكم بالمتصفح" v={<Pill tone="info">معطلة افتراضياً</Pill>} />
          <Row k="سجل التدقيق" v={<Pill tone="neutral">يتطلب PostgreSQL واتصالًا حقيقيًا</Pill>} />
        </Panel>
        <Panel title="تفويض الخادم المحلي">
          <p className="mb-3 text-xs text-muted-foreground">انسخ الرمز الذي يولّده برنامج التشغيل المحلي. الرمز يمنح صلاحية التحكم في الخدمة، فلا تشاركه مع أحد. يُحفظ مؤقتًا في جلسة المتصفح ويُمسح عند إغلاقها.</p>
          <label htmlFor="paw-local-token" className="mb-2 block text-sm">رمز الاتصال المحلي</label>
          <Input id="paw-local-token" type="password" autoComplete="off" dir="ltr" value={token} onChange={(e) => setToken(e.target.value)} placeholder="الصق RUNTIME_TOKEN هنا" />
          <div className="mt-3 flex gap-2">
            <Button disabled={MOCK_MODE || token.trim().length < 32} onClick={saveToken}>حفظ للجلسة</Button>
            <Button variant="outline" disabled={!tokenExists} onClick={clearToken}>إلغاء التفويض</Button>
          </div>
          {MOCK_MODE && <p className="mt-2 text-xs text-muted-foreground">أوقف وضع البيانات التجريبية محليًا قبل استخدام رمز الاتصال.</p>}
        </Panel>
        <Panel title="اللغة">
          <div className="flex gap-2">
            <Button variant={lang === "ar" ? "default" : "secondary"} onClick={() => setLang("ar")}>العربية</Button>
            <Button variant={lang === "en" ? "default" : "secondary"} onClick={() => setLang("en")}>English</Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
