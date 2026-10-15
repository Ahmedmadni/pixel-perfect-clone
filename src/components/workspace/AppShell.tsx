import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Activity, Bell, BookOpen, CalendarClock, Globe, LayoutDashboard, MessageSquare,
  OctagonX, Quote, Settings, ShieldCheck, Users,
} from "lucide-react";
import { useI18n, type DictKey } from "@/lib/i18n";
import { useControl } from "@/lib/control-context";
import { api, MOCK_MODE } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
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

function ConnectionPill() {
  const q = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000, retry: 0 });
  if (MOCK_MODE) return <Pill tone="warning">وضع تجريبي</Pill>;
  if (q.isPending) return <Pill tone="neutral" dot>جارٍ الاتصال</Pill>;
  if (q.error) return <Pill tone="danger">غير متصل</Pill>;
  return <Pill tone="success" dot>متصل محلياً</Pill>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { snap, send } = useControl();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
          <ShieldCheck className="size-5 text-sidebar-primary" />
          <div>
            <div className="text-sm font-semibold">{t("appName")}</div>
            <div className="font-mono text-[10px] text-muted-foreground">local-first · phase 1</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-primary"
            >
              <n.icon className="size-4" />
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3 text-xs text-muted-foreground">
          <button className="hover:text-foreground" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {MOCK_MODE && (
          <div className="border-b border-warning/40 bg-warning/10 px-6 py-1.5 text-center text-xs text-warning">
            {t("mockMode")} — لا توجد تكاملات حقيقية متصلة. شغّل الخادم المحلي واضبط VITE_MOCK_MODE=false.
          </div>
        )}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/90 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <ControlBadge state={snap.state} />
            <ConnectionPill />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={snap.state === "STOPPED"}
            onClick={() => send({ type: "EMERGENCY_STOP" })}
          >
            <OctagonX className="size-4" /> {t("emergencyStop")}
          </Button>
        </header>
        <main className="flex-1 bg-grid p-6">{children}</main>
      </div>
    </div>
  );
}
