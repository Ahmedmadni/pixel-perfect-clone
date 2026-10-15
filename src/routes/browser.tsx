import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Hand, Monitor, Pause, Play, RotateCcw, ShieldAlert, Plus, X } from "lucide-react";
import { api, MOCK_MODE, NOVNC_URL } from "@/lib/api/client";
import { useControl } from "@/lib/control-context";
import { canSend } from "@/lib/control-machine";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BrowserTabAction } from "@/lib/api/types";
import { ControlBadge, PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/browser")({
  head: pageHead("مساحة المتصفح", "Live view of the local Chromium via noVNC with manual and agent handoff."),
  component: BrowserPage,
});

function BrowserPage() {
  const { snap, send, connected, pending } = useControl();
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: 0, refetchInterval: 10000 });
  const tabs = useQuery({ queryKey: ["tabs"], queryFn: api.browserTabs, retry: 0, refetchInterval: 5000 });
  const [address, setAddress] = useState("");
  const [tabError, setTabError] = useState<string | null>(null);
  const tabOperation = useMutation({
    mutationFn: (action: BrowserTabAction) => api.browserAction(action),
    onSuccess: () => { setTabError(null); void qc.invalidateQueries({ queryKey: ["tabs"] }); },
    onError: (e: Error) => setTabError(e.message),
  });
  const [connect, setConnect] = useState(false);
  const s = snap.state;
  const noVncReady = health.data?.services.some((x) => x.name === "novnc" && x.status === "up") ?? false;
  const browserReady = health.data?.services.some((x) => x.name === "playwright" && x.status === "up") ?? false;
  const agentReady = health.data?.services.some((x) => x.name === "agent" && x.status === "up") ?? false;
  const mayAct = MOCK_MODE || (connected && !pending);
  const mayEditTabs = !MOCK_MODE && connected && !pending && !tabOperation.isPending && s === "MANUAL" && browserReady;
  const selectedTabId = tabs.data?.find((t) => t.active)?.id ?? tabs.data?.[0]?.id;
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
            <Button size="sm" disabled={!mayAct || (!MOCK_MODE && (!noVncReady || !browserReady || !agentReady)) || !canSend(s, "START_AGENT")} onClick={() => send({ type: "START_AGENT" })}><Play className="size-4" /> تسليم للوكيل</Button>
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
                <div key={t.id} className={`flex items-center gap-1 rounded-t-md border border-b-0 px-2 py-1.5 text-xs ${t.active ? "bg-card" : "border-transparent text-muted-foreground"}`}>
                  <button type="button" disabled={!mayEditTabs} onClick={() => tabOperation.mutate({ action: "activate", tabId: t.id })} title={t.url} className="max-w-40 truncate">{t.title}</button>
                  <button type="button" disabled={!mayEditTabs || ts.length <= 1} onClick={() => tabOperation.mutate({ action: "close", tabId: t.id })} title="إغلاق التبويب"><X className="size-3" /></button>
                </div>
              ))}
            </QueryState>
            <button type="button" disabled={!mayEditTabs} title="تبويب جديد" onClick={() => tabOperation.mutate({ action: "new" })} className="rounded-md p-2 hover:bg-muted disabled:opacity-40"><Plus className="size-4" /></button>
          </div>
          <form className="flex gap-2 border-b p-2" onSubmit={(e) => {
            e.preventDefault();
            if (mayEditTabs && selectedTabId && address.trim()) tabOperation.mutate({ action: "navigate", tabId: selectedTabId, url: address.trim() });
          }}>
            <Input dir="ltr" aria-label="عنوان الموقع" type="url" placeholder="https://example.com" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!mayEditTabs} />
            <Button size="sm" type="submit" disabled={!mayEditTabs || !selectedTabId || !address.trim()}>انتقال</Button>
          </form>
          {tabError && <p role="alert" className="px-3 py-2 text-xs text-destructive">تعذر تنفيذ العملية: {tabError}</p>}
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
          {!MOCK_MODE && !agentReady && <Pill tone="neutral">محرك التصفح موجود لكن الوكيل المستقل لم يُفعّل بعد</Pill>}
        </div>
      </div>
    </>
  );
}
