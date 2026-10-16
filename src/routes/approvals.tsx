import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, MOCK_MODE } from "@/lib/api/client";
import type { ApprovalDraft, ApprovalKind, ApprovalRequest } from "@/lib/api/types";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/approvals")({
  head: pageHead("مراجعة الموافقات", "User-reviewed immutable drafts. Approval never dispatches an external action."),
  component: ApprovalsPage,
});

const riskTone = { low: "success", medium: "warning", high: "danger" } as const;
const riskLabel = { low: "منخفضة", medium: "متوسطة", high: "عالية" } as const;
const labels: Record<ApprovalKind,string> = {
  external_message: "مسودة رسالة خارجية",
  publish_comment: "مسودة تعليق أو منشور",
  project_change: "تغيير في مشروع",
  other: "إجراء حساس آخر",
};
const empty: ApprovalDraft = {kind:"external_message",action:"",target:"",preview:""};

function ApprovalsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["approvals"], queryFn: api.approvals, retry: 0, refetchInterval: 10000 });
  const [draft, setDraft] = useState<ApprovalDraft>({...empty});
  const [displayForm, setDisplayForm] = useState(false);
  const create = useMutation({
    mutationFn: (d: ApprovalDraft) => api.createApprovalDraft(d),
    onSuccess: () => {
      setDraft({...empty}); setDisplayForm(false);
      void qc.invalidateQueries({queryKey:["approvals"]});
      toast.success("تم حفظ مسودة المراجعة دون تنفيذ أي إجراء خارجي");
    },
    onError: (e: Error) => toast.error("تعذر حفظ المسودة: " + e.message),
  });
  const decide = useMutation({
    mutationFn: (v: {id:string; decision:"approve"|"reject"; digest:string}) => api.decide(v.id,v.decision,v.digest),
    onSuccess: (response, vars) => {
      qc.setQueryData<ApprovalRequest[]>(["approvals"], (existing) =>
        (existing ?? []).map((a) => a.id === vars.id ? {...a,...response} : a),
      );
      void qc.invalidateQueries({queryKey:["approvals"]});
      toast.success(vars.decision === "approve"
        ? "تم اعتماد نص المسودة فقط — لم يتم إرسال أو نشر أي شيء"
        : "تم رفض المسودة");
    },
    onError: (e: Error) => {
      toast.error("لم تُعتمد المسودة: " + e.message);
      void qc.invalidateQueries({queryKey:["approvals"]});
    },
  });
  function submitDraft() {
    if (MOCK_MODE || create.isPending) return;
    const clean: ApprovalDraft = {
      ...draft,
      action:draft.action.trim(),target:draft.target.trim(),preview:draft.preview.trim(),
    };
    if(!clean.action || !clean.target || !clean.preview) return;
    create.mutate(clean);
  }
  function decideDraft(r: ApprovalRequest, decision:"approve"|"reject") {
    if(MOCK_MODE) {
      toast.info("هذا عرض تجريبي؛ لا توجد موافقات حقيقية");
      return;
    }
    if(!r.payloadDigest) {
      toast.error("لا توجد بصمة للمحتوى — أعِد تحميل القائمة");
      return;
    }
    const message = decision === "approve"
      ? "هل اطلعت على النص كاملًا وتوافق على حفظ اعتماده كمسودة فقط؟ لن تُرسل رسالة أو يُنشر تعليق."
      : "هل تريد رفض هذه المسودة؟";
    if(!window.confirm(message)) return;
    decide.mutate({id:r.id,decision,digest:r.payloadDigest});
  }

  return (
    <>
      <PageHeader title="طلبات الموافقة"
        desc="كل اعتماد يخص نص مسودة محددة. لا يرسل النظام رسائل أو ينشر تعليقات بمجرد اعتمادها."
        actions={<Button disabled={MOCK_MODE} onClick={() => setDisplayForm((x) => !x)}>
          {displayForm ? "إغلاق النموذج" : "إنشاء مسودة مراجعة"}
        </Button>}
      />
      {MOCK_MODE && <p className="mb-4 rounded-lg border border-amber-400/40 p-3 text-sm text-amber-700 dark:text-amber-300">
        وضع تجريبي: الأمثلة الظاهرة ليست موافقات فعلية، ولا يتم تنفيذ أي إجراء خارجي.
      </p>}
      {displayForm && !MOCK_MODE && (
        <Panel title="إنشاء مسودة تتطلب اعتمادًا">
          <p className="mb-3 text-xs text-muted-foreground">تظل هذه مسودة قابلة للمراجعة فقط. انتهاء الموافقة بعد ساعة واحدة، والقرارات لا تُنفّذ خارجيًا.</p>
          <div className="space-y-3">
            <label className="block text-sm" htmlFor="approval-kind">نوع الإجراء المقترح</label>
            <select id="approval-kind" className="w-full rounded-md border bg-background p-2 text-sm"
              value={draft.kind} onChange={(e) => setDraft((d)=>({...d,kind:e.target.value as ApprovalKind}))}>
              {(Object.keys(labels) as ApprovalKind[]).map((key)=><option key={key} value={key}>{labels[key]}</option>)}
            </select>
            <label className="block text-sm" htmlFor="approval-action">الإجراء</label>
            <Input id="approval-action" value={draft.action} maxLength={120} placeholder="مثلاً: مراجعة مسودة رد"
              onChange={(e)=>setDraft((d)=>({...d,action:e.target.value}))} />
            <label className="block text-sm" htmlFor="approval-target">الجهة أو الصفحة</label>
            <Input id="approval-target" value={draft.target} maxLength={240}
              onChange={(e)=>setDraft((d)=>({...d,target:e.target.value}))} placeholder="اسم الجهة دون معلومات تسجيل الدخول" />
            <label className="block text-sm" htmlFor="approval-preview">النص الكامل للمراجعة</label>
            <Textarea id="approval-preview" rows={4} maxLength={4000} value={draft.preview}
              onChange={(e)=>setDraft((d)=>({...d,preview:e.target.value}))} />
            <Button disabled={create.isPending||!draft.action.trim()||!draft.target.trim()||!draft.preview.trim()}
              onClick={submitDraft}>{create.isPending ? "جارٍ الحفظ…" : "حفظ المسودة للموافقة"}</Button>
          </div>
        </Panel>
      )}
      <div className="mt-4 space-y-3">
        <QueryState q={q} empty="لا توجد مسودات تحتاج مراجعة">
          {(rs) => rs.map((r) => (
            <Panel key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2 font-medium">
                    {r.action}
                    <Pill tone={riskTone[r.risk]}>خطورة {riskLabel[r.risk]}</Pill>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {labels[r.kind]} · {r.target} · {fmtTime(r.createdAt)}
                  </div>
                  <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-primary ps-3 text-sm">{r.preview}</blockquote>
                  {r.expiresAt && <p className="text-xs text-muted-foreground">تنتهي صلاحية القرار: {fmtTime(r.expiresAt)}</p>}
                  <p className="text-xs text-muted-foreground">الموافقة لا تمنح صلاحية إرسال أو تعديل حسابات؛ لا يوجد محرك تنفيذ خارجي.</p>
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={decide.isPending||MOCK_MODE} onClick={() => decideDraft(r,"approve")}>اعتماد المسودة فقط</Button>
                    <Button size="sm" variant="outline" disabled={decide.isPending||MOCK_MODE} onClick={() => decideDraft(r,"reject")}>رفض</Button>
                  </div>
                ) : (
                  <Pill tone={r.status === "approved" ? "success" : r.status === "expired" ? "warning" : "danger"}>
                    {r.status === "approved" ? "مسودة معتمدة" : r.status === "expired" ? "انتهت الصلاحية" : "مرفوضة"}
                  </Pill>
                )}
              </div>
            </Panel>
          ))}
        </QueryState>
      </div>
    </>
  );
}
