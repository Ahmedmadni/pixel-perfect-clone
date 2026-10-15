import { createFileRoute } from "@tanstack/react-router";
import { API_BASE, MOCK_MODE, NOVNC_URL } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/settings")({
  head: pageHead("إعدادات النظام", "Local runtime endpoints, security posture and language."),
  component: SettingsPage,
});

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-3 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function SettingsPage() {
  const { lang, setLang } = useI18n();
  return (
    <>
      <PageHeader title="إعدادات النظام" desc="تُضبط القيم عبر ملف .env.local على جهازك." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="الاتصال المحلي">
          <Row k="وضع البيانات" v={MOCK_MODE ? <Pill tone="warning">تجريبي (Mock)</Pill> : <Pill tone="success">حقيقي</Pill>} />
          <Row k="VITE_LOCAL_API_URL" v={<code dir="ltr" className="font-mono text-xs">{API_BASE}</code>} />
          <Row k="VITE_NOVNC_URL" v={<code dir="ltr" className="font-mono text-xs">{NOVNC_URL}</code>} />
        </Panel>
        <Panel title="الأمان">
          <Row k="الاستماع على" v={<code className="font-mono text-xs">127.0.0.1 فقط</code>} />
          <Row k="المصادقة" v={<Pill tone="neutral">رمز محلي (المرحلة 2)</Pill>} />
          <Row k="صلاحيات التحكم بالمتصفح" v={<Pill tone="info">معطلة افتراضياً</Pill>} />
          <Row k="سجل التدقيق" v={<Pill tone="primary">مفعّل</Pill>} />
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
