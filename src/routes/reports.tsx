import { createFileRoute, Link } from "@tanstack/react-router";
import { reportsSearch } from "@/lib/workspace-links";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search } from "lucide-react";
import { api, MOCK_MODE } from "@/lib/api/client";
import { filterLogs, type LogFilter } from "@/lib/activity-view";
import { TaskMonitor } from "@/components/workspace/TaskMonitor";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/reports")({
  head: pageHead("مركز المهام والتقارير", "Read-only task inspection, activity logs and local notifications."),
  validateSearch: reportsSearch,
  component: ReportsPage,
});

const levelTone = { info: "info", warn: "warning", error: "danger", audit: "primary" } as const;
const levelLabel = { all: "الكل", audit: "تدقيق", info: "معلومات", warn: "تنبيه", error: "خطأ" } as const;

function ReportsPage() {
  const {taskId} = Route.useSearch();
  const qc = useQueryClient();
  const logs = useQuery({ queryKey: ["logs"], queryFn: api.logs, refetchInterval: 10000, retry: 0 });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks, refetchInterval: 10000, retry: 0 });
  const notices = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 10000, retry: 0 });
  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
  const [lvl, setLvl] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");

  return (
    <>
      <PageHeader
        title="مركز المهام والتقارير"
        desc={MOCK_MODE
          ? "لا توجد مهام أو سجلات فعلية في Lovable؛ ستظهر فقط بيانات الخدمات المحلية بعد توصيلها."
          : "متابعة حالة المهام الفعلية وسجل التدقيق والتنبيهات من الخدمات المحلية، دون تغيير حالة أي مهمة."}
      />
      <div className="space-y-5">
        <QueryState q={tasks} empty="لا توجد مهام مسجّلة في هذه المساحة.">
          {(items) => <TaskMonitor tasks={items} preview={MOCK_MODE} focusedTaskId={taskId} />}
        </QueryState>

        <Panel title="تنبيهات المهام المحلية">
          {MOCK_MODE && <p className="mb-3 text-xs text-warning" role="note">لا توجد تنبيهات متصلة من الخادم المحلي في المعاينة.</p>}
          <QueryState q={notices} empty="لا توجد إشعارات بعد">
            {(items) => (
              <ul className="divide-y">
                {items.map((notice) => (
                  <li key={notice.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={notice.kind === "task_done" ? "success" : notice.kind === "task_failed" ? "danger" : "neutral"}>
                          {notice.kind === "task_done" ? "اكتملت" : notice.kind === "task_cancelled" ? "ملغاة" : "فشلت"}
                        </Pill>
                        <span className={notice.readAt ? "break-words text-muted-foreground" : "break-words font-medium"}>{notice.message}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{fmtTime(notice.createdAt)}</p>
                      {notice.taskId && (
                        <Link to="/reports" search={{taskId:notice.taskId}}
                          className="mt-2 inline-flex rounded-md border px-3 py-1.5 text-xs text-primary hover:bg-muted"
                          aria-label="عرض المهمة المرتبطة بالتنبيه">
                          عرض تفاصيل المهمة المرتبطة
                        </Link>
                      )}
                    </div>
                    {!notice.readAt && !MOCK_MODE && (
                      <Button size="sm" variant="outline" disabled={markRead.isPending}
                        onClick={() => markRead.mutate(notice.id)}>تحديد كمقروء</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          {markRead.error && <p className="mt-2 text-xs text-destructive">تعذر تحديث الإشعار: {markRead.error.message}</p>}
        </Panel>

        <Panel title="سجل النشاط والتدقيق">
          {MOCK_MODE && <p className="mb-3 text-xs text-warning" role="note">لا توجد سجلات نشاط محلية متصلة داخل Lovable.</p>}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor="activity-log-search" className="flex min-w-0 flex-1 items-center gap-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Input id="activity-log-search" aria-label="البحث في السجل" placeholder="ابحث في الأحداث أو الجهة…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية سجل النشاط">
              {(["all", "audit", "info", "warn", "error"] as const).map((level) => (
                <Button key={level} size="sm" variant={lvl === level ? "default" : "outline"}
                  aria-pressed={lvl === level} onClick={() => setLvl(level)}>
                  {levelLabel[level]}
                </Button>
              ))}
            </div>
          </div>
          <QueryState q={logs} empty="لا توجد سجلات حتى الآن.">
            {(entries) => {
              const filtered = filterLogs(entries, lvl, search);
              return (
                <>
                  <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">{filtered.length} من {entries.length} حدث</p>
                  {filtered.length ? (
                    <ul className="divide-y">
                      {filtered.map((log) => (
                        <li key={log.id} className="flex flex-wrap items-start gap-2 py-3 text-sm sm:gap-3">
                          <time className="w-full shrink-0 text-xs text-muted-foreground sm:w-32" dateTime={log.at}>{fmtTime(log.at)}</time>
                          <Pill tone={levelTone[log.level]}>{levelLabel[log.level]}</Pill>
                          <span className="text-xs text-muted-foreground">{log.actor}</span>
                          <span className="min-w-0 flex-1 break-words">{log.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" role="status">
                      لا توجد أحداث تطابق عوامل التصفية.
                      <div className="mt-3">
                        <Button size="sm" variant="outline" onClick={() => { setLvl("all"); setSearch(""); }}>إعادة ضبط الفلاتر</Button>
                      </div>
                    </div>
                  )}
                </>
              );
            }}
          </QueryState>
        </Panel>
      </div>
    </>
  );
}
