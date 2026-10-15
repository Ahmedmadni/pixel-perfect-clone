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
  const { snap, send, connected, pending } = useControl();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: 0, refetchInterval: 10000 });
  const tabs = useQuery({ queryKey: ["tabs"], queryFn: api.browserTabs });
  const [connect, setConnect] = useState(false);
  const s = snap.state;
  const noVncReady = health.data?.services.some((x) => x.name === "novnc" && x.status === "up") ?? false;
  const agentReady = health.data?.services.some((x) => x.name === "playwright" && x.status === "up") ?? false;
  const mayAct = MOCK_MODE || (connected && !pending);
  const canConnect = !MOCK_MODE && connected && noVncReady;
  const viewOnly = !connected || pending || s !== "MANUAL";
  const viewerUrl = new URL(NOVNC_URL);
  if (viewOnly) viewerUrl.searchParams.set("view_only", "1");
  else viewerUrl.searchParams.delete("view_only");

  return (
    <>
      <PageHeader
        title="مساحة المتصفح"
        desc="عرض متصفح Chromium الحقيقي على جهازك عبر noVNC. لا يتم تضمين المواقع عبر iframe عادي."
        actions={
          <>
            <Button size="sm" disabled={!mayAct || (!MOCK_MODE && (!noVncReady || !agentReady)) || !canSend(s, "START_AGENT")} onClick={() => send({ type: "START_AGENT" })}><Play className="size-4" /> تسليم للوكيل</Button>
            <Button size="sm" variant="secondary" disabled={!mayAct || !canSend(s, "TAKE_OVER")} onClick={() => send({ type: "TAKE_OVER" })}><Hand className="size-4" /> استلام يدوي</Button>
            <Button size="sm" variant="secondary" disabled={!mayAct || (!canSend(s, "PAUSE") && !canSend(s, "RESUME"))} onClick={() => send({ type: s === "PAUSED" ? "RESUME" : "PAUSE" })}><Pause className="size-4" /> {s === "PAUSED" ? "استئناف" : "إيقاف مؤقت"}</Button>
            <Button size="sm" variant="outline" disabled={!mayAct || !canSend(s, "RESET")} onClick={() => send({ type: "RESET" })}><RotateCcw className="size-4" /> إعادة ضبط</Button>
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
            {connect && canConnect ? (
              <div className="relative size-full">
                <iframe title="noVNC" src={viewerUrl.toString()} className="size-full" inert={viewOnly} tabIndex={viewOnly ? -1 : 0} style={{ pointerEvents: viewOnly ? "none" : "auto" }} />
                {viewOnly && <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/10 pb-4" aria-label="المشاهدة فقط — التحكم مقفل"><span className="rounded-md bg-background/90 px-3 py-1 text-xs text-foreground">وضع المشاهدة فقط — لا يمكنك التحكم أثناء عمل الوكيل</span></div>}
              </div>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
                <Monitor className="size-12 text-muted-foreground" />
                <div>
                  <div className="font-medium">شاشة المتصفح المحلي غير متصلة</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {MOCK_MODE ? "الوضع التجريبي مفعّل — لا يوجد متصفح حقيقي." : !connected ? "لم يتم تأكيد الاتصال بالخادم. أدخل الرمز في الإعدادات أولاً." : !noVncReady ? "noVNC غير متحقق من تشغيله بعد؛ لا يمكن فتح جلسة تجريبية باعتبارها متصفحًا حقيقيًا." : `المتصفح متاح على ${NOVNC_URL}`}
                  </p>
                </div>
                <Button disabled={!canConnect} onClick={() => setConnect(true)}>الاتصال بـ noVNC</Button>
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
            {MOCK_MODE && s === "AGENT_ACTIVE" && (
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
          {!MOCK_MODE && !noVncReady && <Pill tone="warning">المتصفح الحقيقي غير متحقق بعد</Pill>}
          {!MOCK_MODE && !agentReady && <Pill tone="neutral">وكيل التصفح لم يتصل بعد</Pill>}
        </div>
      </div>
    </>
  );
}
