import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import type { ApprovalRequest } from "@/lib/api/types";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/approvals")({
  head: pageHead("الموافقات والتنبيهات", "Review and approve or reject actions the agent wants to take."),
  component: ApprovalsPage,
});

const riskTone = { low: "success", medium: "warning", high: "danger" } as const;
const riskLabel = { low: "منخفضة", medium: "متوسطة", high: "عالية" };

function ApprovalsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["approvals"], queryFn: api.approvals });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject" }) => api.decide(v.id, v.decision),
    onSuccess: (_r, v) => {
      qc.setQueryData<ApprovalRequest[]>(["approvals"], (c) =>
        (c ?? []).map((a) => (a.id === v.id ? { ...a, status: v.decision === "approve" ? "approved" : "rejected" } : a)),
      );
      toast.success(v.decision === "approve" ? "تمت الموافقة" : "تم الرفض");
    },
    onError: (e) => toast.error(`فشل: ${e.message}`),
  });
  return (
    <>
      <PageHeader title="الموافقات والتنبيهات" desc="لا ينفذ الوكيل الإجراءات الحساسة إلا بعد موافقتك." />
      <div className="space-y-3">
        <QueryState q={q} empty="لا توجد طلبات">
          {(rs) => rs.map((r) => (
            <Panel key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium">{r.action} <Pill tone={riskTone[r.risk]}>خطورة {riskLabel[r.risk]}</Pill></div>
                  <div className="text-xs text-muted-foreground">{r.target} · {fmtTime(r.createdAt)}</div>
                  <blockquote className="mt-2 border-s-2 border-primary ps-3 text-sm">{r.preview}</blockquote>
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "approve" })}>موافقة</Button>
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "reject" })}>رفض</Button>
                  </div>
                ) : (
                  <Pill tone={r.status === "approved" ? "success" : "danger"}>{r.status === "approved" ? "تمت الموافقة" : "مرفوض"}</Pill>
                )}
              </div>
            </Panel>
          ))}
        </QueryState>
      </div>
    </>
  );
}
