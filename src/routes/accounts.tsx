import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, MOCK_MODE } from "@/lib/api/client";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, Pill, QueryState } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/accounts")({
  head: pageHead("الحسابات وصلاحيات القراءة", "Explicit local domain permissions, with external actions disabled."),
  component: AccountsPage,
});

function AccountsPage() {
  const qc = useQueryClient();
  const q = useQuery({queryKey:["accounts"],queryFn:api.accounts,retry:0,refetchInterval:15000});
  const [domain,setDomain]=useState("");
  const [label,setLabel]=useState("");
  const create=useMutation({
    mutationFn:()=>api.registerReviewDomain(domain.trim(),label.trim()),
    onSuccess:()=>{
      setDomain("");setLabel("");
      toast.success("تم تسجيل الموقع وصلاحية المراجعة معطلة افتراضيًا");
      void qc.invalidateQueries({queryKey:["accounts"]});
    },
    onError:(e:Error)=>toast.error("تعذر التسجيل: "+e.message),
  });
  const setReview=useMutation({
    mutationFn:(input:{id:string;allow:boolean})=>api.setDomainReview(input.id,input.allow),
    onSuccess:(_,v)=>{
      toast.success(v.allow?"تم السماح بالمراجعة للقراءة فقط":"تم إلغاء صلاحية المراجعة وأُرسلت إشارة لإيقاف المهمة النشطة");
      void qc.invalidateQueries({queryKey:["accounts"]});
      void qc.invalidateQueries({queryKey:["tasks"]});
    },
    onError:(e:Error)=>{
      toast.error("لم تتغير الصلاحية: "+e.message);
      void qc.invalidateQueries({queryKey:["accounts"]});
    },
  });

  return (
    <>
      <PageHeader title="المواقع وصلاحيات الوكيل"
        desc="تسجل الدخول بنفسك داخل Chromium. هنا تمنح إذن قراءة محددًا، وليس إذن إرسال أو نشر." />
      <div className="space-y-4">
        <Panel title="إضافة موقع مسموح بمراجعته">
          <p className="mb-3 text-xs text-muted-foreground">
            تُضاف المواقع أولًا بوضع المنع. حتى بعد السماح بالقراءة يجب إدراج النطاق في قائمة العامل المحلي المسموح بها، ولا يتم تجاوز سياسات المنصات.
          </p>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input aria-label="النطاق" dir="ltr" placeholder="example.org" maxLength={253} value={domain} disabled={MOCK_MODE||create.isPending}
              onChange={(e)=>setDomain(e.target.value)} />
            <Input aria-label="اسم الموقع" placeholder="اسم وصفي للموقع" maxLength={120} value={label} disabled={MOCK_MODE||create.isPending}
              onChange={(e)=>setLabel(e.target.value)} />
            <Button disabled={MOCK_MODE||create.isPending||!domain.trim()||!label.trim()}
              onClick={()=>create.mutate()}>{create.isPending?"جارٍ الحفظ…":"إضافة"}</Button>
          </div>
          {MOCK_MODE && <p className="mt-2 text-xs text-amber-600">الوضع التجريبي: الإضافات الحقيقية غير متاحة.</p>}
        </Panel>
        <Panel title="نطاقات المراجعة المسجلة">
          <QueryState q={q} empty="لم تُسجل مواقع بعد">
            {(accounts)=>(
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 text-start">الموقع</th>
                      <th className="py-2 text-start">النطاق</th>
                      <th className="py-2 text-start">حالة الدخول</th>
                      <th className="py-2 text-start">قراءة الوكيل</th>
                      <th className="py-2 text-start">نشر / إرسال</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account)=>(
                      <tr key={account.id} className="border-b last:border-0">
                        <td className="py-3">{account.label}</td>
                        <td dir="ltr" className="font-mono text-xs text-start">{account.domain ?? "بيانات تجريبية"}</td>
                        <td><Pill tone="neutral">غير محقق</Pill></td>
                        <td>
                          <Switch checked={Boolean(account.canReview)}
                            disabled={MOCK_MODE||setReview.isPending||!account.domain}
                            aria-label={`السماح بالقراءة من ${account.label}`}
                            onCheckedChange={(allow)=>setReview.mutate({id:account.id,allow})} />
                        </td>
                        <td><Pill tone="danger">محظور</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
          <p className="mt-3 text-xs text-muted-foreground">
            لا تُحفظ كلمات المرور هنا، ولا نعتمد على توقعات حالة تسجيل الدخول. صلاحية القراءة وحدها لا تكفي لتفعيل تنفيذ الإجراءات الخارجية.
          </p>
        </Panel>
      </div>
    </>
  );
}
