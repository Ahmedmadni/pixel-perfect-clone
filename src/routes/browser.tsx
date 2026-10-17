import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Globe, Hand, Monitor, Plus, RefreshCw, Square, X } from "lucide-react";
import { api, MOCK_MODE, NOVNC_URL } from "@/lib/api/client";
import type { BrowserTabAction } from "@/lib/api/types";
import { useControl } from "@/lib/control-context";
import { canSend } from "@/lib/control-machine";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Pill } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/browser")({
  head: pageHead("المتصفح الذكي", "Your local browser tabs and the assistant alongside them."),
  component: BrowserPage,
});

/** One workspace, one actual Chromium session, one selected tab for each task. */
function BrowserPage() {
  const qc=useQueryClient();
  const {snap,send,connected,pending}=useControl();
  const health=useQuery({queryKey:["health"],queryFn:api.health,retry:0,refetchInterval:10000});
  const tabs=useQuery({queryKey:["tabs"],queryFn:api.browserTabs,retry:0,refetchInterval:5000});
  const models=useQuery({queryKey:["models"],queryFn:api.models,retry:0,refetchInterval:30000});
  const tasks=useQuery({queryKey:["tasks"],queryFn:api.tasks,retry:0,refetchInterval:3000});
  const [url,setUrl]=useState("");
  const [instruction,setInstruction]=useState("");
  const [chosenModel,setChosenModel]=useState("");
  const [showBrowser,setShowBrowser]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const availableModels=models.data?.models??[];
  const model=availableModels.some(m=>m.name===chosenModel)?chosenModel:availableModels[0]?.name??"";
  const currentTab=tabs.data?.find(t=>t.active)??null;
  const state=snap.state;
  const browserReady=health.data?.services.some(x=>x.name==="playwright"&&x.status==="up")??false;
  const vncReady=health.data?.services.some(x=>x.name==="novnc"&&x.status==="up")??false;
  const aiReady=health.data?.services.some(x=>x.name==="agent"&&x.status==="up")??false;
  const manual=connected&&!pending&&state==="MANUAL"&&browserReady&&!MOCK_MODE;
  const active=tasks.data?.find(t=>t.status==="running"||t.status==="queued");
  const latest=tasks.data?.find(t=>t.result||t.error);
  const canReview=manual&&aiReady&&vncReady&&!!currentTab&&!!model&&instruction.trim().length>=4&&!active;
  const vnc=new URL(NOVNC_URL);
  if(state!=="MANUAL")vnc.searchParams.set("view_only","1");
  else vnc.searchParams.delete("view_only");

  const tabsMutation=useMutation({
    mutationFn:(data:BrowserTabAction)=>api.browserAction(data),
    onSuccess:()=>{setError(null);void qc.invalidateQueries({queryKey:["tabs"]});},
    onError:(e:Error)=>setError(e.message),
  });
  const review=useMutation({
    mutationFn:()=>api.startReview(instruction.trim(),currentTab?.id??"",model),
    onSuccess:()=>{setError(null);setInstruction("");void qc.invalidateQueries({queryKey:["tasks"]});},
    onError:(e:Error)=>setError(e.message),
  });
  const cancel=useMutation({
    mutationFn:(id:string)=>api.cancelReview(id),
    onSuccess:()=>{void qc.invalidateQueries({queryKey:["tasks"]});},
    onError:(e:Error)=>setError(e.message),
  });
  function browse(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(manual&&currentTab&&url.trim())tabsMutation.mutate({action:"navigate",tabId:currentTab.id,url:url.trim()});
  }

  return <>
    <PageHeader title="المتصفح الذكي" desc="افتح موقعك في التاب، ثم اكتب التعليمات بجانبه. لا توجد حسابات أو رسائل أو نتائج افتراضية." />
    {MOCK_MODE && (
      <div role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        <strong>هذه معاينة Lovable فقط:</strong> لا يمكنها تشغيل متصفح على جهازك أو تنفيذ مهام.
        كل البيانات خالية حتى توصل التشغيل المحلي الحقيقي. لا يوجد متصفح وهمي مخفي وراء هذه الشاشة.
      </div>
    )}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(290px,355px)]">
      <section aria-label="المتصفح" className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-2" aria-label="تبويبات Chromium الحقيقية">
          {tabs.data?.map(t=>(
            <div key={t.id} className={`flex max-w-44 items-center gap-1 rounded-md border px-2 py-1.5 text-xs ${t.active?"border-primary/40 bg-background":"border-transparent text-muted-foreground"}`}>
              <button type="button" aria-current={t.active?"page":undefined} disabled={!manual}
                className="max-w-32 truncate" title={t.url}
                onClick={()=>tabsMutation.mutate({action:"activate",tabId:t.id})}>{t.title||t.url||"تبويب جديد"}</button>
              <button type="button" disabled={!manual||(tabs.data?.length??0)<=1}
                aria-label={"إغلاق "+t.title} onClick={()=>tabsMutation.mutate({action:"close",tabId:t.id})}><X className="size-3"/></button>
            </div>
          ))}
          {(!tabs.data?.length&&!tabs.isPending)&&<p className="px-2 py-1 text-xs text-muted-foreground">لا توجد تبويبات متصلة</p>}
          <Button size="icon" variant="outline" title="تبويب جديد" aria-label="تبويب جديد" disabled={!manual||tabsMutation.isPending}
            onClick={()=>tabsMutation.mutate({action:"new"})}><Plus className="size-4"/></Button>
        </div>
        <form className="flex min-w-0 items-center gap-2 border-b p-2" onSubmit={browse}>
          <Globe className="hidden size-4 shrink-0 text-muted-foreground sm:block"/>
          <Input aria-label="عنوان الموقع" dir="ltr" type="url" placeholder="https://example.com" value={url}
            onChange={e=>setUrl(e.target.value)} disabled={!manual||tabsMutation.isPending}/>
          <Button size="sm" disabled={!manual||!currentTab||!url.trim()||tabsMutation.isPending}>فتح</Button>
        </form>
        <div className="relative min-h-[400px] bg-sidebar xl:min-h-[550px]" data-testid="browser-viewport">
          {showBrowser&&!MOCK_MODE&&connected&&vncReady ? (
            <div className="absolute inset-0">
              <iframe title="متصفح Chromium المحلي" src={vnc.toString()} className="size-full"
                inert={state!=="MANUAL"} tabIndex={state==="MANUAL"?0:-1}
                style={{pointerEvents:state==="MANUAL"?"auto":"none"}}/>
              {state!=="MANUAL" && <div className="absolute inset-0 flex items-end justify-center bg-black/10 pb-3 text-center text-xs pointer-events-none">
                <span className="rounded-md bg-background/90 px-3 py-2">التحكم اليدوي مقفل أثناء عمل المساعد</span>
              </div>}
            </div>
          ) : (
            <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 p-6 text-center xl:min-h-[550px]">
              <Monitor className="size-12 text-muted-foreground"/>
              <h2 className="font-medium">{MOCK_MODE?"المتصفح غير متصل في المعاينة":"شاشة المتصفح غير مفتوحة"}</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {MOCK_MODE?"لا نعرض مواقع أو تبويبات وهمية. شغّل المشروع محليًا لتفتح المواقع وتستخدمها."
                  :!connected?"شغّل الخدمات المحلية واربط رمز الوصول من الإعدادات."
                  :!browserReady||!vncReady?"خدمة Chromium أو عرض الشاشة غير متاحة بعد."
                  :"اضغط لعرض نافذة Chromium نفسها، بما فيها التبويبات التي فتحتها."}
              </p>
              <Button disabled={MOCK_MODE||!connected||!vncReady} onClick={()=>setShowBrowser(true)}>عرض المتصفح الحقيقي</Button>
              {!MOCK_MODE&&!connected&&<Link to="/settings" className="text-sm text-primary underline">إعداد الاتصال</Link>}
            </div>
          )}
        </div>
      </section>
      <aside aria-label="المساعد الذكي" className="min-w-0 space-y-4">
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">المساعد الذكي</h2>
            <Pill tone={aiReady&&!MOCK_MODE?"success":"neutral"}>{aiReady&&!MOCK_MODE?"متاح":"غير جاهز"}</Pill>
          </div>
          <p className="text-xs text-muted-foreground">التاب المختار: <strong className="break-all">{currentTab?.title??"لا يوجد تاب متصل"}</strong></p>
          <label className="block text-xs" htmlFor="browser-model">النموذج المحلي</label>
          <select id="browser-model" className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={model} disabled={MOCK_MODE||!availableModels.length||!!active}
            onChange={e=>setChosenModel(e.target.value)}>
            {!model&&<option value="">لا يوجد نموذج Ollama متصل</option>}
            {availableModels.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <label htmlFor="browser-instruction" className="block text-xs">اكتب المطلوب من المساعد في نفس التاب</label>
          <Textarea id="browser-instruction" value={instruction} onChange={e=>setInstruction(e.target.value)}
            disabled={MOCK_MODE||!!active} rows={5}
            placeholder="مثال: انزل إلى نهاية الصفحة، أو افتح رابط الشروط داخل الموقع، أو لخص ما تراه"/>
          <Button className="w-full" disabled={!canReview||review.isPending}
            onClick={()=>review.mutate()}>{review.isPending?"جارٍ البدء…":"ابدأ المهمة في هذا التاب"}</Button>
          <p className="text-xs text-muted-foreground">
            <strong>المتاح في التشغيل المحلي:</strong> تلخيص الصفحة، التمرير، فتح روابط داخل نفس الموقع،
            وملء حقول النص والبحث دون إرسال. يستخدم Ollama لتحديد الخطوة، ويتوقف بعد أربع خطوات كحد أقصى.
            <strong> إرسال الرسائل، الضغط على أزرار التنفيذ، الدفع والحذف غير مدعوم تلقائيًا.</strong>
            لا تظهر نتيجة حقيقية إلا بعد تشغيل المهمة على جهازك.
          </p>
          {active && <div role="status" className="space-y-2 rounded-md border p-3 text-xs">
            <p>المهمة قيد التشغيل: {active.title}</p>
            <Button size="sm" variant="destructive" disabled={cancel.isPending} onClick={()=>cancel.mutate(active.id)}>
              <Square className="size-3"/> إلغاء المهمة
            </Button>
          </div>}
          {latest && <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3 text-xs">
            <strong>{latest.status==="done"?"آخر نتيجة مكتملة":"آخر محاولة"}</strong>
            {latest.result&&<p className="whitespace-pre-wrap break-words">{latest.result}</p>}
            {latest.error&&<p className="text-destructive">{latest.error}</p>}
          </div>}
          {error&&<p role="alert" className="break-words text-xs text-destructive">{error}</p>}
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">التحكم في الجلسة</h3>
          <p className="text-xs text-muted-foreground">الحالة الفعلية: {connected?state:"لا يوجد اتصال محلي"}</p>
          {connected&&canSend(state,"RESET")&&<Button className="w-full" variant="outline" disabled={pending} onClick={()=>void send({type:"RESET"})}><RefreshCw className="size-4"/> تفعيل المتصفح اليدوي</Button>}
          {connected&&canSend(state,"TAKE_OVER")&&<Button className="w-full" variant="outline" disabled={pending} onClick={()=>void send({type:"TAKE_OVER"})}><Hand className="size-4"/> استرجاع التحكم</Button>}
          {!MOCK_MODE&&!aiReady&&<p className="text-xs text-muted-foreground">المساعد يحتاج تشغيل Ollama وعامل Chromium المحلي. اختيار التاب والضغط على بدء المهمة هو التفويض المحدد لهذا الموقع؛ لا توجد حاجة لقائمة طويلة من المواقع.</p>}
          {MOCK_MODE&&<p className="text-xs text-muted-foreground">لا توجد جلسة متصفح أو مهمة فعلية في Lovable.</p>}
        </section>
      </aside>
    </div>
  </>;
}
