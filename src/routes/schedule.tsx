import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, MOCK_MODE } from "@/lib/api/client";
import { pageHead } from "@/lib/seo";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/schedule")({
  head: pageHead("المهام المجدولة", "Recurring agent tasks with cron schedules and approval gates."),
  component: SchedulePage,
});

function SchedulePage() {
  const q = useQuery({ queryKey: ["schedules"], queryFn: api.schedules });
  return (
    <>
      <PageHeader title="المهام المجدولة" desc={MOCK_MODE ? "عرض تصميم الجدولة ببيانات تجريبية فقط؛ لا تعمل أي مهمة تلقائيًا." : "عرض المهام المجدولة من الخادم المحلي؛ تفعيل الجدولة غير متاح من هذه الشاشة."} />
      {MOCK_MODE && <p role="status" className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">جميع المهام والتواريخ الظاهرة أمثلة للمعاينة فقط، حتى لو ظهرت علامة التفعيل.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <QueryState q={q}>
          {(ss) => ss.map((s) => (
            <Panel key={s.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{s.title}</div>
                  <div dir="ltr" className="mt-1 text-end font-mono text-xs text-muted-foreground">{s.cron}</div>
                </div>
                <Switch checked={s.enabled} disabled aria-label="تفعيل" />
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                التشغيل القادم: {fmtTime(s.nextRunAt)}
                {s.requiresApproval && <Pill tone="warning">يتطلب موافقة</Pill>}
              </div>
            </Panel>
          ))}
        </QueryState>
      </div>
    </>
  );
}
