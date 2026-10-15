import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, MOCK_MODE } from "@/lib/api/client";
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
      <PageHeader title="نظرة عامة" desc="حالة الوكيل والخدمات المحلية على جهازك." />
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
