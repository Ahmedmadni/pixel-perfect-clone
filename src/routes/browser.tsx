import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Hand, Monitor, Pause, Play, RotateCcw, ShieldAlert } from "lucide-react";
import { api, MOCK_MODE, NOVNC_URL } from "@/lib/api/client";
import { useControl } from "@/lib/control-context";
import { canSend } from "@/lib/control-machine";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { ControlBadge, PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/browser")({
  head: pageHead("مساحة المتصفح", "Live view of the local Chromium via noVNC with manual and agent handoff."),
  component: BrowserPage,
});

function BrowserPage() {
  const { snap, send } = useControl();
  const tabs = useQuery({ queryKey: ["tabs"], queryFn: api.browserTabs });
  const [connect, setConnect] = useState(false);
  const s = snap.state;

  return (
    <>
      <PageHeader
        title="مساحة المتصفح"
        desc="عرض متصفح Chromium الحقيقي على جهازك عبر noVNC. لا يتم تضمين المواقع عبر iframe عادي."
        actions={
          <>
            <Button size="sm" disabled={!canSend(s, "START_AGENT")} onClick={() => send({ type: "START_AGENT" })}><Play className="size-4" /> تسليم للوكيل</Button>
            <Button size="sm" variant="secondary" disabled={!canSend(s, "TAKE_OVER")} onClick={() => send({ type: "TAKE_OVER" })}><Hand className="size-4" /> استلام يدوي</Button>
            <Button size="sm" variant="secondary" disabled={!canSend(s, "PAUSE") && !canSend(s, "RESUME")} onClick={() => send({ type: s === "PAUSED" ? "RESUME" : "PAUSE" })}><Pause className="size-4" /> {s === "PAUSED" ? "استئناف" : "إيقاف مؤقت"}</Button>
            <Button size="sm" variant="outline" disabled={!canSend(s, "RESET")} onClick={() => send({ type: "RESET" })}><RotateCcw className="size-4" /> إعادة ضبط</Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-1 border-b bg-muted/50 px-2 pt-2">
            <QueryState q={tabs} empty="لا توجد تبويبات">
              {(ts) => ts.map((t) => (
                <div key={t.id} className={`rounded-t-md border border-b-0 px-3 py-1.5 text-xs ${t.active ? "bg-card" : "border-transparent text-muted-foreground"}`}>
                  {t.title} <span className="font-mono opacity-50">· {t.profileId}</span>
                </div>
              ))}
            </QueryState>
          </div>
          <div className="relative aspect-video bg-sidebar">
            {connect && !MOCK_MODE ? (
              <iframe title="noVNC" src={NOVNC_URL} className="size-full" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
                <Monitor className="size-12 text-muted-foreground" />
                <div>
                  <div className="font-medium">شاشة المتصفح المحلي غير متصلة</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {MOCK_MODE ? "الوضع التجريبي مفعّل — لا يوجد متصفح حقيقي." : `سيتم الاتصال بـ ${NOVNC_URL}`}
                  </p>
                </div>
                <Button disabled={MOCK_MODE} onClick={() => setConnect(true)}>الاتصال بـ noVNC</Button>
              </div>
            )}
            {s === "AGENT_ACTIVE" && <div className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-primary/60" />}
            {s === "APPROVAL_REQUIRED" && <div className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-warning/70" />}
          </div>
        </div>
        <div className="space-y-4">
          <Panel title="حالة التحكم">
            <ControlBadge state={s} />
            {s === "APPROVAL_REQUIRED" && (
              <div className="mt-3 space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-warning"><ShieldAlert className="size-4" /> طلب موافقة</div>
                <p>{snap.reason}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => send({ type: "APPROVE" })}>موافقة</Button>
                  <Button size="sm" variant="outline" onClick={() => send({ type: "REJECT" })}>رفض</Button>
                </div>
              </div>
            )}
            {s === "AGENT_ACTIVE" && (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => send({ type: "REQUEST_APPROVAL", reason: "محاكاة: الوكيل يريد إرسال رسالة" })}>
                محاكاة طلب موافقة
              </Button>
            )}
          </Panel>
          <Panel title="سجل الانتقالات">
            {snap.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد انتقالات بعد.</p>
            ) : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto font-mono text-[11px]">
                {snap.history.map((h, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{fmtTime(h.at)}</span>
                    <span dir="ltr">{h.from} → {h.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {MOCK_MODE && <Pill tone="warning">التبويبات المعروضة وهمية</Pill>}
        </div>
      </div>
    </>
  );
}
