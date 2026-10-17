import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, CheckCircle2, Clock3, ListChecks, Search, ShieldAlert } from "lucide-react";
import type { AgentTask, TaskStatus } from "@/lib/api/types";
import { filterTasks, summarizeTasks, TASK_LABELS, TASK_STATES, type TaskFilter } from "@/lib/activity-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, Pill, fmtTime, type Tone } from "./ui-bits";

const statusTone: Record<TaskStatus, Tone> = {
  queued: "neutral", running: "info", awaiting_approval: "warning",
  done: "success", failed: "danger", cancelled: "neutral",
};

function SummaryItem({ label, count, icon: Icon }: {
  label: string; count: number; icon: typeof Activity;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-3">
      <div className="rounded-md bg-muted p-2"><Icon aria-hidden="true" className="size-4 text-primary" /></div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{count}</p>
      </div>
    </div>
  );
}

/** Read-only task inspector. Filtering and expanding rows are entirely local UI state. */
export function TaskMonitor({ tasks, preview, focusedTaskId }: { tasks: AgentTask[]; preview: boolean; focusedTaskId?: string | undefined }) {
  const [status, setStatus] = useState<TaskFilter>("all");
  const [search, setSearch] = useState("");
  const counts = summarizeTasks(tasks);
  const visible = filterTasks(tasks, status, search);
  const focusedTask = focusedTaskId ? tasks.find((item) => item.id === focusedTaskId) : undefined;

  return (
    <div className="space-y-4" data-testid="task-monitor">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryItem label="إجمالي المهام" count={counts.total} icon={ListChecks} />
        <SummaryItem label="قيد المتابعة" count={counts.pending} icon={Activity} />
        <SummaryItem label="مكتملة" count={counts.done} icon={CheckCircle2} />
        <SummaryItem label="تحتاج موافقة" count={counts.awaiting_approval} icon={ShieldAlert} />
      </div>
      <Panel title="متابعة المهام">
        {preview && (
          <p role="note" className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            جميع المهام هنا أمثلة للمعاينة، ولا يتم تشغيل مهام فعلية أو إرسال بيانات إلى أي حساب.
            البحث وفتح التفاصيل يغيّران العرض فقط.
          </p>
        )}
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-2" htmlFor="task-monitor-search">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input id="task-monitor-search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بعنوان المهمة أو الهدف…" aria-label="البحث في المهام" />
          </label>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {visible.length} من {counts.total} مهمة
          </span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="تصفية المهام حسب الحالة">
          <Button size="sm" variant={status === "all" ? "default" : "outline"} aria-pressed={status === "all"} onClick={() => setStatus("all")}>
            الكل ({counts.total})
          </Button>
          {TASK_STATES.map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} aria-pressed={status === s}
              onClick={() => setStatus(s)}>
              {TASK_LABELS[s]} ({counts[s]})
            </Button>
          ))}
        </div>
        {focusedTaskId && (
          <div role="status" className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            {focusedTask ? (
              <>تم تحديد المهمة المرتبطة بالتنبيه: <strong>{focusedTask.title}</strong>.
                يمكنك مراجعة خطواتها أدناه دون تغيير حالتها.</>
            ) : (
              <>لم تظهر المهمة المطلوبة ضمن أحدث السجلات المتاحة؛ قد تكون أقدم من حد العرض الحالي.
                لن نعرض مهمة أخرى بدلًا منها.</>
            )}
          </div>
        )}
        {visible.length ? (
          <ul className="divide-y">
            {visible.map((t) => (
              <li key={t.id} className={t.id === focusedTaskId ? "rounded-md border border-primary/40 bg-primary/5 px-2 py-3" : "py-3"}>
                <details
                  ref={(node) => { if (node && t.id === focusedTaskId && !node.open) node.open = true; }}
                  className="group" data-testid={"task-detail-" + t.id}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-md px-1 py-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium">{t.title}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> {fmtTime(t.createdAt)}</span>
                    </span>
                    <Pill tone={statusTone[t.status]}>{TASK_LABELS[t.status]}</Pill>
                    <span className="text-xs text-muted-foreground group-open:hidden">عرض التفاصيل +</span>
                    <span className="hidden text-xs text-muted-foreground group-open:inline">إخفاء التفاصيل −</span>
                  </summary>
                  <div className="ms-1 mt-2 space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                    {t.objective && <p className="break-words"><strong>الهدف:</strong> {t.objective}</p>}
                    {t.status === "awaiting_approval" && (
                      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                        <p>هذه المهمة معروضة كمنتظرة للموافقة. النظام لا يسجل حاليًا معرّف مسودة مرتبطة بها.</p>
                        <Link to="/approvals" search={{status:"pending"}} className="mt-2 inline-block text-primary underline">
                          عرض جميع المسودات المعلقة (وليست بالضرورة مرتبطة بهذه المهمة)
                        </Link>
                      </div>
                    )}
                    {t.model && <p className="break-all"><strong>النموذج:</strong> <span dir="ltr">{t.model}</span></p>}
                    {t.finishedAt && <p><strong>الانتهاء:</strong> {fmtTime(t.finishedAt)}</p>}
                    {t.result && <div><strong>النتيجة:</strong><p className="mt-1 whitespace-pre-wrap break-words">{t.result}</p></div>}
                    {t.error && <p role="alert" className="break-words text-destructive"><strong>سبب الفشل:</strong> {t.error}</p>}
                    {t.steps?.length ? (
                      <ol className="space-y-2 border-s ps-3">
                        {t.steps.map((step, i) => (
                          <li key={i} className="break-words">
                            <span className="font-medium">{step.phase}:</span> {step.detail}
                            <span className="ms-2 text-xs text-muted-foreground">{fmtTime(step.at)}</span>
                          </li>
                        ))}
                      </ol>
                    ) : !t.result && !t.error && <p className="text-xs text-muted-foreground">لم تُسجّل خطوات أو نتائج إضافية لهذه المهمة.</p>}
                    <p className="border-t pt-2 text-xs text-muted-foreground">هذه شاشة عرض ومراجعة فقط. فتح التفاصيل لا يغيّر حالة المهمة أو صلاحياتها.</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground" role="status">
            لا توجد مهام تطابق البحث والتصفية الحالية.
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => { setSearch(""); setStatus("all"); }}>إعادة ضبط الفلاتر</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
