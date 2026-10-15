import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/client";
import type { ActivityLog } from "@/lib/api/types";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/reports")({
  head: pageHead("التقارير والسجلات", "Activity and audit logs from the agent, user and system."),
  component: ReportsPage,
});

const levelTone = { info: "info", warn: "warning", error: "danger", audit: "primary" } as const;
type Lvl = ActivityLog["level"] | "all";

function ReportsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["logs"], queryFn: api.logs, refetchInterval: 10000 });
  const notices = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 10000, retry: 0 });
  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
  const [lvl, setLvl] = useState<Lvl>("all");
  return (
    <>
      <PageHeader
        title="التقارير وسجلات النشاط"
        desc="سجل تدقيق لكل إجراء من المستخدم أو الوكيل أو النظام."
        actions={(["all", "audit", "info", "warn", "error"] as const).map((l) => (
          <Button key={l} size="sm" variant={lvl === l ? "default" : "secondary"} onClick={() => setLvl(l)}>{l === "all" ? "الكل" : l}</Button>
        ))}
      />
      <Panel title="تنبيهات المهام المحلية">
        <QueryState q={notices} empty="لا توجد إشعارات بعد">
          {(items) => (
            <ul className="divide-y">
              {items.map((notice) => (
                <li key={notice.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <Pill tone={notice.kind === "task_done" ? "success" : notice.kind === "task_failed" ? "danger" : "neutral"}>
                        {notice.kind === "task_done" ? "اكتملت" : notice.kind === "task_cancelled" ? "ملغاة" : "فشلت"}
                      </Pill>
                      <span className={notice.readAt ? "text-muted-foreground" : "font-medium"}>{notice.message}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtTime(notice.createdAt)}</p>
                  </div>
                  {!notice.readAt && <Button size="sm" variant="outline" disabled={markRead.isPending} onClick={() => markRead.mutate(notice.id)}>تحديد كمقروء</Button>}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
        {markRead.error && <p className="mt-2 text-xs text-destructive">تعذر تحديث الإشعار: {markRead.error.message}</p>}
      </Panel>
      <Panel>
        <QueryState q={q}>
          {(ls) => (
            <ul className="divide-y font-mono text-xs">
              {ls.filter((l) => lvl === "all" || l.level === lvl).map((l) => (
                <li key={l.id} className="flex items-center gap-4 py-2.5">
                  <span className="w-28 text-muted-foreground">{fmtTime(l.at)}</span>
                  <Pill tone={levelTone[l.level]}>{l.level}</Pill>
                  <span className="w-14 text-muted-foreground">{l.actor}</span>
                  <span className="font-sans text-sm">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
