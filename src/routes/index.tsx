import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, MOCK_MODE } from "@/lib/api/client";
import { filterTasks, TASK_LABELS } from "@/lib/activity-view";
import { useControl } from "@/lib/control-context";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { ControlBadge, PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/")({
  head: pageHead("نظرة عامة", "Agent status, local services health and pending approvals."),
  component: Overview,
});

const svcTone = { up: "success", down: "danger", unknown: "neutral" } as const;

function Overview() {
  const { snap, connected } = useControl();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: 0 });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: api.approvals });
  const logs = useQuery({ queryKey: ["logs"], queryFn: api.logs });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });

  return (
    <>
      <PageHeader title="نظرة عامة" desc={MOCK_MODE ? "معاينة تصميم مساحة العمل — البيانات التجريبية لا تعكس حالة حساباتك." : "حالة الوكيل والخدمات المحلية على جهازك."} />
      {MOCK_MODE && (
        <Panel className="mb-4 border-warning/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <p className="font-medium">أنت تستعرض واجهة المشروع — وليس خدمات الكمبيوتر المحلية</p>
              <p className="mt-1 text-sm text-muted-foreground">
                يمكنك التنقل بين الصفحات وتجربة شكل لوحات التحكم، لكن تبويبات المتصفح
                والمحادثات والحسابات والمهام هنا أمثلة غير حقيقية. التطوير يُحفظ في GitHub،
                أما تشغيل Ollama وPostgreSQL وChromium فيكون محليًا عند مرحلة الاختبار.
              </p>
            </div>
            <a href="https://github.com/Ahmedmadni/pixel-perfect-clone"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-accent">
              مراجعة المستودع على GitHub
            </a>
          </div>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-4">
        <Panel className="lg:col-span-1">
          <div className="text-xs text-muted-foreground">وضع التحكم</div>
          <div className="mt-2">{connected ? <ControlBadge state={snap.state} /> : <Pill tone="danger">حالة التحكم غير متحققة</Pill>}</div>
          {snap.reason && <p className="mt-2 text-xs text-muted-foreground">{snap.reason}</p>}
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">موافقات معلقة</div>
          <div className="mt-1 font-mono text-3xl">{approvals.data?.filter((a) => a.status === "pending").length ?? "—"}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">مهام في الطابور</div>
          <div className="mt-1 font-mono text-3xl">{tasks.data?.filter((t) => ["queued", "running", "awaiting_approval"].includes(t.status)).length ?? "—"}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">مصدر البيانات</div>
          <div className="mt-2">{MOCK_MODE ? <Pill tone="warning">وهمية (Mock)</Pill> : connected ? <Pill tone="success">خادم محلي متحقق</Pill> : <Pill tone="danger">لم يُؤكد الاتصال</Pill>}</div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="الخدمات المحلية">
          <QueryState q={health}>
            {(h) => (
              <ul className="divide-y">
                {h.services.map((s) => (
                  <li key={s.name} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-mono">{s.name}</span>
                    <Pill tone={svcTone[s.status]}>{s.status === "unknown" ? "غير محقق" : s.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          <p className="mt-3 text-xs text-muted-foreground">لن يتم وصف أي خدمة بأنها تعمل حتى تنجح اختبارات التكامل المحلية.</p>
        </Panel>
        <Panel title="متابعة المهام" actions={<Button asChild size="sm" variant="ghost"><Link to="/reports">مركز المهام</Link></Button>}>
          <QueryState q={tasks} empty="لا توجد مهام حتى الآن.">
            {(items) => (
              <ul className="divide-y">
                {filterTasks(items, "all", "").slice(0, 4).map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0 flex-1 break-words text-sm">{task.title}</span>
                    <Pill tone={task.status === "done" ? "success" : task.status === "failed" ? "danger" : task.status === "awaiting_approval" ? "warning" : "neutral"}>
                      {TASK_LABELS[task.status]}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          <p className="mt-3 text-xs text-muted-foreground">{MOCK_MODE ? "أمثلة للمعاينة فقط — ليست مهامًا حقيقية." : "استعرض كل المهام وخطواتها في مركز المتابعة."}</p>
        </Panel>
        <Panel title="آخر النشاطات" actions={<Button asChild size="sm" variant="ghost"><Link to="/reports">الكل</Link></Button>}>
          <QueryState q={logs}>
            {(l) => (
              <ul className="space-y-2 text-sm">
                {l.slice(0, 5).map((x) => (
                  <li key={x.id} className="flex gap-3">
                    <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{fmtTime(x.at)}</span>
                    <span>{x.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Panel>
      </div>
    </>
  );
}
