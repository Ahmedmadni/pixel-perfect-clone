import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  const q = useQuery({ queryKey: ["logs"], queryFn: api.logs, refetchInterval: 10000 });
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
