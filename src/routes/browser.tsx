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
import { Textarea } from "@/components/ui/textarea";
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
  const models = useQuery({ queryKey: ["models"], queryFn: api.models, retry: 0, refetchInterval: 30000 });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks, retry: 0, refetchInterval: 3000 });
  const [objective, setObjective] = useState("");
  const [model, setModel] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const selectedModel = models.data?.models.some((m) => m.name === model) ? model : models.data?.models[0]?.name ?? "";
  const activeReview = tasks.data?.find((t) => t.status === "queued" || t.status === "running");
  const latestReview = tasks.data?.find((t) => t.result || t.error);
  const runReview = useMutation({
    mutationFn: () => api.startReview(objective.trim(), selectedTabId ?? "", selectedModel),
    onSuccess: () => { setReviewError(null); void qc.invalidateQueries({ queryKey: ["tasks"] }); void qc.invalidateQueries({ queryKey: ["agentStatus"] }); },
    onError: (e: Error) => setReviewError(e.message),
  });
  const cancelReview = useMutation({
    mutationFn: (id: string) => api.cancelReview(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e: Error) => setReviewError(e.message),
  });
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
  const mayReview = !MOCK_MODE && connected && !pending && s === "MANUAL" && noVncReady && browserReady && agentReady && Boolean(selectedTabId) && Boolean(selectedModel) && !activeReview && !runReview.isPending && objective.trim().length >= 4;
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
            <Button size="sm" disabled={!MOCK_MODE || !canSend(s, "START_AGENT")} onClick={() => send({ type: "START_AGENT" })}><Play className="size-4" /> {MOCK_MODE ? "محاكاة تسليم" : "ابدأ مهمة مراجعة أدناه"}</Button>
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
            <Button size="sm" type="button" variant="outline" disabled={!mayEditTabs || !selectedTabId} onClick={() => selectedTabId && tabOperation.mutate({ action: "activate", tabId: selectedTabId })}>تفعيل التحكم اليدوي</Button>
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
          <Panel title="مراجعة صفحة بالذكاء الاصطناعي (قراءة فقط)">
            <p className="mb-3 text-xs text-muted-foreground">افتح الموقع وسجّل الدخول بنفسك. حدد المهمة وسنراجع فقط التبويب النشط المصرح به؛ لن تُرسل أي رسالة أو تعليق أو تعديل.</p>
            <div className="space-y-2">
              <label htmlFor="agent-review-model" className="block text-xs">نموذج Ollama</label>
              <select id="agent-review-model" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={selectedModel} onChange={(e) => setModel(e.target.value)} disabled={!!activeReview || models.isPending || !!models.error}>
                {!selectedModel && <option value="">لا يوجد نموذج محلي</option>}
                {models.data?.models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
              <label htmlFor="agent-review-objective" className="block text-xs">تعليمات المهمة</label>
              <Textarea id="agent-review-objective" rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} disabled={!!activeReview} placeholder="راجع التعليقات الظاهرة على الصفحة واقترح ردودًا مناسبة لأسلوبي دون نشرها" />
              <Button className="w-full" disabled={!mayReview} onClick={() => runReview.mutate()}>بدء المراجعة الآمنة</Button>
              {activeReview && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
                  <p>مهمة قيد التشغيل: {activeReview.title}</p>
                  <Button size="sm" variant="destructive" disabled={cancelReview.isPending} onClick={() => cancelReview.mutate(activeReview.id)}>إلغاء المهمة</Button>
                </div>
              )}
              {latestReview && (
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2 text-xs">
                  <p className="font-medium">آخر تقرير: {latestReview.status === "done" ? "مكتمل" : latestReview.status === "cancelled" ? "ملغى" : "لم يكتمل"}</p>
                  {latestReview.result && <p className="whitespace-pre-wrap">{latestReview.result}</p>}
                  {latestReview.error && <p className="text-destructive">{latestReview.error}</p>}
                  {latestReview.steps?.map((step, i) => <p key={i} className="text-muted-foreground">{step.phase}: {step.detail}</p>)}
                </div>
              )}
              {reviewError && <p role="alert" className="text-xs text-destructive">{reviewError}</p>}
              {!MOCK_MODE && !agentReady && <p className="text-xs text-muted-foreground">الوكيل غير مفعّل حتى يتوفر Ollama والمتصفح ويُصرّح له بالنطاقات من إعدادات التشغيل المحلية.</p>}
              {MOCK_MODE && <Pill tone="warning">هذه الواجهة تجريبية؛ المهام الحقيقية متوقفة</Pill>}
            </div>
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
