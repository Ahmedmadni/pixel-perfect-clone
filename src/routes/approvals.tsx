import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Clock3, Search, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, MOCK_MODE } from "@/lib/api/client";
import type { ApprovalDraft, ApprovalKind, ApprovalRequest } from "@/lib/api/types";
import {
  APPROVAL_LABELS, APPROVAL_STATES, RISK_LABELS,
  canDecideApproval, effectiveApprovalStatus, filterApprovals, summarizeApprovals,
  type ApprovalFilter, type ApprovalRiskFilter,
} from "@/lib/approval-view";
import { pageHead } from "@/lib/seo";
import { approvalsSearch } from "@/lib/workspace-links";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, Pill, QueryState, fmtTime, type Tone } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/approvals")({
  head: pageHead("مركز الموافقات", "Read-only review of immutable drafts. Decisions never dispatch external actions."),
  validateSearch: approvalsSearch,
  component: ApprovalsPage,
});

const riskTone = { low:"success", medium:"warning", high:"danger" } as const satisfies Record<ApprovalRequest["risk"], Tone>;
const stateTone = {
  pending:"warning", approved:"success", rejected:"danger", expired:"neutral",
} as const satisfies Record<ApprovalRequest["status"], Tone>;
const kinds: Record<ApprovalKind,string> = {
  external_message: "مسودة رسالة خارجية",
  publish_comment: "مسودة تعليق أو منشور",
  project_change: "تغيير في مشروع",
  other: "إجراء حساس آخر",
};
const empty: ApprovalDraft = {kind:"external_message",action:"",target:"",preview:""};
type Decision = "approve" | "reject";

function ApprovalsPage() {
  const {status:linkedStatus} = Route.useSearch();
  const qc = useQueryClient();
  const query = useQuery({queryKey:["approvals"], queryFn:api.approvals, retry:0, refetchInterval:10000});
  const [draft,setDraft] = useState<ApprovalDraft>({...empty});
  const [displayForm,setDisplayForm] = useState(false);
  const [stateFilter,setStateFilter] = useState<ApprovalFilter>(linkedStatus ?? "all");
  useEffect(() => { setStateFilter(linkedStatus ?? "all"); }, [linkedStatus]);
  const [riskFilter,setRiskFilter] = useState<ApprovalRiskFilter>("all");
  const [search,setSearch] = useState("");
  const [review,setReview] = useState<{record:ApprovalRequest;decision:Decision}|null>(null);
  const [checked,setChecked] = useState(false);
  // Ephemeral presentation only: nothing is stored, networked, or used as authorization in MOCK_MODE.
  const [demoDecisions,setDemoDecisions] = useState<Record<string,"approved"|"rejected">>({});

  const create = useMutation({
    mutationFn: (value: ApprovalDraft) => api.createApprovalDraft(value),
    onSuccess: () => {
      setDraft({...empty});
      setDisplayForm(false);
      void qc.invalidateQueries({queryKey:["approvals"]});
      toast.success("تم حفظ مسودة مراجعة فقط، دون تنفيذ إجراء خارجي.");
    },
    onError: (error:Error) => toast.error("تعذر حفظ المسودة: "+error.message),
  });
  const decide = useMutation({
    mutationFn: (value:{id:string;decision:Decision;digest:string}) =>
      api.decide(value.id,value.decision,value.digest),
    onSuccess: (response, value) => {
      qc.setQueryData<ApprovalRequest[]>(["approvals"],(existing) =>
        (existing ?? []).map((a)=>a.id===value.id?{...a,...response}:a));
      void qc.invalidateQueries({queryKey:["approvals"]});
      setReview(null);
      setChecked(false);
      toast.success(value.decision==="approve"
        ? "تم تسجيل اعتماد المسودة فقط، ولم يُرسل أو يُنشر شيء."
        : "تم تسجيل رفض المسودة.");
    },
    onError: (error:Error) => {
      toast.error("تعذر تسجيل القرار: "+error.message);
      void qc.invalidateQueries({queryKey:["approvals"]});
    },
  });

  const items = (query.data ?? []).map((item) =>
    MOCK_MODE && demoDecisions[item.id] ? {...item,status:demoDecisions[item.id]!} : item);
  const counts = summarizeApprovals(items);
  const visible = filterApprovals(items,stateFilter,riskFilter,search);
  const activeRecord = review && items.find((item)=>item.id===review.record.id);
  const unchanged = !!activeRecord &&
    activeRecord.preview===review?.record.preview &&
    activeRecord.payloadDigest===review?.record.payloadDigest &&
    activeRecord.action===review?.record.action &&
    activeRecord.target===review?.record.target;
  const mayConfirm = !!review && !!activeRecord && unchanged && canDecideApproval(activeRecord) &&
    checked && !decide.isPending && (MOCK_MODE || !!activeRecord.payloadDigest);

  function submitDraft() {
    if(MOCK_MODE || create.isPending)return;
    const clean={...draft,
      action:draft.action.trim(),target:draft.target.trim(),preview:draft.preview.trim()};
    if(!clean.action||!clean.target||!clean.preview)return;
    create.mutate(clean);
  }
  function openReview(record:ApprovalRequest,decision:Decision) {
    if(!canDecideApproval(record)) {
      toast.error("انتهت صلاحية هذه المسودة أو سبق تسجيل قرار بشأنها.");
      return;
    }
    setChecked(false);
    setReview({record,decision});
  }
  function confirmDecision() {
    if(!mayConfirm || !review || !activeRecord)return;
    if(MOCK_MODE) {
      setDemoDecisions((existing)=>({
        ...existing,
        [activeRecord.id]:review.decision==="approve"?"approved":"rejected",
      }));
      toast.info("محاكاة قرار داخل الواجهة فقط، لم يُحفَظ أو يُرسل أي شيء.");
      setReview(null);
      setChecked(false);
      return;
    }
    // The backend revalidates immutable SHA-256 digest, status and expiry transactionally.
    decide.mutate({
      id:activeRecord.id,decision:review.decision,digest:activeRecord.payloadDigest!,
    });
  }

  return (
    <>
      <PageHeader title="مركز الموافقات"
        desc="مراجعة مسودات محددة مع فحص الصلاحية والمخاطر قبل حفظ أي قرار. اعتماد النص لا يشغّل رسالة أو منشورًا."
        actions={<Button disabled={MOCK_MODE} onClick={()=>setDisplayForm((value)=>!value)}>
          {displayForm?"إغلاق النموذج":"إنشاء مسودة مراجعة"}
        </Button>} />

      {linkedStatus === "pending" && (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs" role="status">
          وصلت إلى جميع المسودات المعلقة من مركز المهام أو رابط مباشر.
          هذه القائمة لا تثبت أن أي مسودة مرتبطة بمهمة محددة.
          <Link to="/reports" search={{}} className="ms-2 text-primary underline">
            العودة إلى التقارير
          </Link>
        </div>
      )}
      {MOCK_MODE && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="note">
          <strong>مختبر موافقات تجريبي:</strong> يمكنك فتح مسودة، مراجعة نصها، ومحاكاة الاعتماد أو الرفض.
          التغييرات مؤقتة داخل الصفحة ولا تُحفَظ في قاعدة البيانات أو تُرسل لأي منصة.
          <Button size="sm" variant="outline" className="ms-3 mt-2 sm:mt-0"
            onClick={()=>{setDemoDecisions({});setReview(null);setChecked(false);}}>
            إعادة ضبط المحاكاة
          </Button>
        </div>
      )}
      {displayForm && !MOCK_MODE && (
        <Panel title="إنشاء مسودة تتطلب اعتمادًا">
          <p className="mb-3 text-xs text-muted-foreground">
            تحفظ المسودة للمراجعة فقط، وتنتهي صلاحيتها بعد ساعة. لا يوجد محرك يرسلها خارجيًا.
          </p>
          <div className="space-y-3">
            <label className="block text-sm" htmlFor="approval-kind">نوع الإجراء المقترح</label>
            <select id="approval-kind" className="w-full rounded-md border bg-background p-2 text-sm"
              value={draft.kind} onChange={(e)=>setDraft((v)=>({...v,kind:e.target.value as ApprovalKind}))}>
              {(Object.keys(kinds) as ApprovalKind[]).map((key)=><option key={key} value={key}>{kinds[key]}</option>)}
            </select>
            <label className="block text-sm" htmlFor="approval-action">الإجراء</label>
            <Input id="approval-action" value={draft.action} maxLength={120}
              placeholder="مثلاً: مراجعة مسودة رد" onChange={(e)=>setDraft((v)=>({...v,action:e.target.value}))} />
            <label className="block text-sm" htmlFor="approval-target">الجهة أو الصفحة</label>
            <Input id="approval-target" value={draft.target} maxLength={240}
              placeholder="اسم الجهة دون معلومات دخول" onChange={(e)=>setDraft((v)=>({...v,target:e.target.value}))} />
            <label className="block text-sm" htmlFor="approval-preview">النص الكامل للمراجعة</label>
            <Textarea id="approval-preview" rows={5} maxLength={4000} value={draft.preview}
              onChange={(e)=>setDraft((v)=>({...v,preview:e.target.value}))} />
            <Button disabled={create.isPending||!draft.action.trim()||!draft.target.trim()||!draft.preview.trim()}
              onClick={submitDraft}>{create.isPending?"جارٍ الحفظ…":"حفظ المسودة للمراجعة"}</Button>
          </div>
        </Panel>
      )}
      <QueryState q={query} empty="لا توجد مسودات للمراجعة">
        {() => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="approval-summary">
              {([
                ["pending","معلقة",Clock3],
                ["approved","معتمدة",CheckCircle2],
                ["rejected","مرفوضة",XCircle],
                ["expired","انتهت صلاحيتها",ShieldCheck],
              ] as const).map(([status,label,Icon])=>(
                <div key={status} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <div className="rounded-md bg-muted p-2"><Icon aria-hidden className="size-4 text-primary" /></div>
                  <div><p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-mono text-2xl font-semibold tabular-nums">{counts[status]}</p>
                  </div>
                </div>
              ))}
            </div>
            <Panel title="قائمة المسودات">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <label htmlFor="approval-search" className="flex min-w-0 flex-1 items-center gap-2">
                  <Search aria-hidden className="size-4 shrink-0 text-muted-foreground"/>
                  <Input id="approval-search" aria-label="البحث في الموافقات"
                    value={search} onChange={(e)=>setSearch(e.target.value)}
                    placeholder="ابحث في الإجراء أو الوجهة أو نص المسودة…" />
                </label>
                <label htmlFor="approval-risk" className="flex items-center gap-2 text-xs">
                  مستوى الخطورة
                  <select id="approval-risk" aria-label="تصفية حسب مستوى الخطورة"
                    value={riskFilter} onChange={(e)=>setRiskFilter(e.target.value as ApprovalRiskFilter)}
                    className="rounded-md border bg-background px-2 py-2 text-sm">
                    <option value="all">جميع المستويات</option>
                    <option value="low">منخفضة</option>
                    <option value="medium">متوسطة</option>
                    <option value="high">عالية</option>
                  </select>
                </label>
              </div>
              <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="تصفية الموافقات حسب الحالة">
                <Button size="sm" variant={stateFilter==="all"?"default":"outline"}
                  aria-pressed={stateFilter==="all"} onClick={()=>setStateFilter("all")}>
                  الكل ({counts.total})
                </Button>
                {APPROVAL_STATES.map((status)=>(
                  <Button key={status} size="sm" variant={stateFilter===status?"default":"outline"}
                    aria-pressed={stateFilter===status} onClick={()=>setStateFilter(status)}>
                    {APPROVAL_LABELS[status]} ({counts[status]})
                  </Button>
                ))}
              </div>
              <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
                {visible.length} من {counts.total} مسودة
              </p>
              {visible.length ? (
                <ul className="divide-y" data-testid="approval-list">
                  {visible.map((record)=>{
                    const effective = effectiveApprovalStatus(record);
                    return (
                      <li key={record.id} className="space-y-3 py-4" data-testid={"approval-"+record.id}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="break-words font-semibold">{record.action}</h3>
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {kinds[record.kind]} · {record.target} · {fmtTime(record.createdAt)}
                            </p>
                            {record.expiresAt && (
                              <p className="mt-1 text-xs text-muted-foreground">تنتهي صلاحية القرار: {fmtTime(record.expiresAt)}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={riskTone[record.risk]}>خطورة {RISK_LABELS[record.risk]}</Pill>
                            <Pill tone={stateTone[effective]}>{APPROVAL_LABELS[effective]}</Pill>
                          </div>
                        </div>
                        <details className="group">
                          <summary className="cursor-pointer rounded-md border p-2 text-sm focus-visible:outline-2 focus-visible:outline-primary">
                            قراءة نص المسودة بالكامل
                          </summary>
                          <blockquote className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-primary p-3 text-sm">
                            {record.preview}
                          </blockquote>
                          {record.payloadDigest && (
                            <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground" dir="ltr">
                              SHA-256: {record.payloadDigest}
                            </p>
                          )}
                        </details>
                        {effective==="pending" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" disabled={decide.isPending}
                              onClick={()=>openReview(record,"approve")}>
                              {MOCK_MODE?"محاكاة اعتماد":"مراجعة واعتماد المسودة"}
                            </Button>
                            <Button size="sm" variant="outline" disabled={decide.isPending}
                              onClick={()=>openReview(record,"reject")}>
                              {MOCK_MODE?"محاكاة رفض":"مراجعة ورفض"}
                            </Button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            لا يمكن إصدار قرار جديد بشأن هذه المسودة.
                            {MOCK_MODE && demoDecisions[record.id] ? " (حالة تجريبية غير محفوظة)" : ""}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">تسجيل الموافقة لا يمنح صلاحية الإرسال أو النشر أو تعديل الحساب.</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-md border border-dashed p-7 text-center text-sm text-muted-foreground" role="status">
                  لا توجد مسودات تطابق البحث والفلاتر الحالية.
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={()=>{setStateFilter("all");setRiskFilter("all");setSearch("");}}>
                      إعادة ضبط الفلاتر
                    </Button>
                  </div>
                </div>
              )}
            </Panel>
          </div>
        )}
      </QueryState>

      <Dialog open={!!review} onOpenChange={(open)=>{if(!open && !decide.isPending){setReview(null);setChecked(false);}}}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{review?.decision==="approve"?"مراجعة اعتماد المسودة":"مراجعة رفض المسودة"}</DialogTitle>
            <DialogDescription>
              {MOCK_MODE?"محاكاة داخل المعاينة فقط، دون حفظ أي قرار.":"قرار يخص النص المعروض فقط ولا يؤدي لإرسال أو نشر شيء."}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Pill tone={riskTone[review.record.risk]}>خطورة {RISK_LABELS[review.record.risk]}</Pill>
                <Pill tone={stateTone[effectiveApprovalStatus(review.record)]}>
                  {APPROVAL_LABELS[effectiveApprovalStatus(review.record)]}
                </Pill>
              </div>
              <p className="break-words text-sm font-medium">{review.record.action} — {review.record.target}</p>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm"
                aria-label="النص الكامل للمسودة">
                {review.record.preview}
              </div>
              {review.record.expiresAt && <p className="text-xs text-muted-foreground">صالحة حتى {fmtTime(review.record.expiresAt)}</p>}
              {!unchanged && <p role="alert" className="text-sm text-destructive">تغيرت بيانات المسودة أثناء مراجعتها. أغلق النافذة وأعد فتح أحدث نسخة.</p>}
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                <Checkbox aria-label="أؤكد مراجعة نص المسودة" checked={checked}
                  onCheckedChange={(value)=>setChecked(value===true)} />
                <span>قرأت نص المسودة كاملًا، وأفهم أن القرار لا يرسل رسائل ولا ينشر تعليقات ولا يعدّل أي حساب.</span>
              </label>
              <DialogFooter>
                <Button variant="outline" disabled={decide.isPending} onClick={()=>{setReview(null);setChecked(false);}}>
                  إلغاء
                </Button>
                <Button disabled={!mayConfirm} variant={review.decision==="reject"?"destructive":"default"}
                  onClick={confirmDecision} aria-label="تأكيد قرار المسودة">
                  {decide.isPending?"جارٍ تسجيل القرار…":MOCK_MODE?"تأكيد المحاكاة":review.decision==="approve"?"تسجيل اعتماد المسودة فقط":"تسجيل الرفض"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
