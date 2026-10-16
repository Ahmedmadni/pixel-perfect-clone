import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, Bell, BookOpen, CalendarClock, Globe, LayoutDashboard, Menu,
  MessageSquare, OctagonX, Quote, Settings, ShieldCheck, Users,
} from "lucide-react";
import { useI18n, type DictKey } from "@/lib/i18n";
import { useControl } from "@/lib/control-context";
import { api, MOCK_MODE } from "@/lib/api/client";
import { isLocalBrowserOrigin } from "@/lib/api/origin";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ControlBadge, Pill } from "./ui-bits";

const NAV = [
  { to: "/", key: "overview", icon: LayoutDashboard },
  { to: "/browser", key: "browser", icon: Globe },
  { to: "/chat", key: "chat", icon: MessageSquare },
  { to: "/knowledge", key: "knowledge", icon: BookOpen },
  { to: "/styles", key: "styles", icon: Quote },
  { to: "/accounts", key: "accounts", icon: Users },
  { to: "/schedule", key: "schedule", icon: CalendarClock },
  { to: "/approvals", key: "approvals", icon: Bell },
  { to: "/reports", key: "reports", icon: Activity },
  { to: "/settings", key: "settings", icon: Settings },
] as const satisfies readonly { to: string; key: DictKey; icon: unknown }[];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label="التنقل الرئيسي" className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          activeOptions={{ exact: n.to === "/" }}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-primary"
        >
          <n.icon className="size-4 shrink-0" />
          <span>{t(n.key)}</span>
        </Link>
      ))}
    </nav>
  );
}

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
      <button type="button" className="hover:text-foreground" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
        {lang === "ar" ? "English" : "العربية"}
      </button>
    </div>
  );
}

function ConnectionPill() {
  const q = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000, retry: 0 });
  if (MOCK_MODE) return <Pill tone="warning">وضع تجريبي</Pill>;
  if (q.isPending) return <Pill tone="neutral" dot>جارٍ الاتصال</Pill>;
  if (q.error) return <Pill tone="danger">الخادم غير متصل</Pill>;
  if (q.data?.services.some((s) => s.name === "postgres" && s.status === "down"))
    return <Pill tone="warning">قاعدة البيانات غير جاهزة</Pill>;
  if (q.data?.degraded) return <Pill tone="warning">خدمات محلية غير متصلة</Pill>;
  return <Pill tone="success" dot>الخادم المحلي متاح</Pill>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const { snap, send, connected, pending } = useControl();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hosted, setHosted] = useState(false);

  // Only after hydration: avoid SSR/client hostname mismatches in the Lovable preview.
  useEffect(() => { setHosted(!isLocalBrowserOrigin()); }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
          <ShieldCheck className="size-5 text-sidebar-primary" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t("appName")}</div>
            <div className="font-mono text-[10px] text-muted-foreground">GitHub source · local-first</div>
          </div>
        </div>
        <Navigation />
        <LanguageToggle />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {(MOCK_MODE || hosted) && (
          <div role="status" className="border-b border-warning/40 bg-warning/10 px-3 py-2 text-center text-xs text-warning sm:px-6">
            {MOCK_MODE
              ? "معاينة تجريبية للواجهة — البيانات المعروضة ليست حسابات أو رسائل حقيقية. خدمات Chromium وOllama وPostgreSQL تعمل محليًا فقط."
              : "المعاينة مستضافة خارج جهازك؛ الاتصال بالخدمات المحلية وإدخال رموزها محظور للحماية."}
          </div>
        )}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/90 px-3 py-3 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 md:hidden" aria-label="فتح القائمة الرئيسية">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side={lang === "ar" ? "right" : "left"} aria-describedby={undefined}
                className="flex h-full w-[min(85vw,20rem)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden">
                <div className="border-b border-sidebar-border px-5 py-5">
                  <SheetTitle className="text-start text-sm text-sidebar-foreground">{t("appName")}</SheetTitle>
                  <p className="mt-1 text-xs text-muted-foreground">GitHub · وضع تجريبي / تشغيل محلي</p>
                </div>
                <Navigation onNavigate={() => setMobileOpen(false)} />
                <LanguageToggle />
              </SheetContent>
            </Sheet>
            <div className="min-w-0">{connected ? <ControlBadge state={snap.state} /> : <Pill tone="danger">التحكم غير متصل</Pill>}</div>
            <div className="hidden sm:block"><ConnectionPill /></div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            disabled={!connected || pending || snap.state === "STOPPED" || snap.state === "ERROR"}
            onClick={() => send({ type: "EMERGENCY_STOP" })}
          >
            <OctagonX className="size-4" />
            <span className="hidden sm:inline">{t("emergencyStop")}</span>
            <span className="sm:hidden">إيقاف</span>
          </Button>
        </header>
        <main className="min-w-0 flex-1 bg-grid p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
