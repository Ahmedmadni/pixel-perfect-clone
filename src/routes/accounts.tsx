import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { pageHead } from "@/lib/seo";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, Pill, QueryState, fmtTime } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/accounts")({
  head: pageHead("الحسابات والجلسات", "Browser profiles, login sessions and agent control permissions."),
  component: AccountsPage,
});

const sessionTone = { unknown: "neutral", logged_in: "success", logged_out: "warning", expired: "danger" } as const;
const sessionLabel = { unknown: "غير محقق", logged_in: "مسجل الدخول", logged_out: "غير مسجل", expired: "منتهية" };

function AccountsPage() {
  const q = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  return (
    <>
      <PageHeader title="الحسابات وجلسات المتصفح" desc="يتم تسجيل الدخول يدوياً داخل المتصفح المحلي. لا تُخزَّن كلمات المرور في التطبيق." />
      <Panel>
        <QueryState q={q}>
          {(as) => (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b text-start">
                  <th className="py-2 text-start">الحساب</th><th className="text-start">الملف الشخصي</th><th className="text-start">الجلسة</th><th className="text-start">آخر فحص</th><th className="text-start">سماح للوكيل</th>
                </tr>
              </thead>
              <tbody>
                {as.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-3">{a.label} <span className="font-mono text-xs text-muted-foreground">{a.platform}</span></td>
                    <td className="font-mono text-xs">{a.profileId}</td>
                    <td><Pill tone={sessionTone[a.session]}>{sessionLabel[a.session]}</Pill></td>
                    <td className="text-xs text-muted-foreground">{fmtTime(a.lastCheckedAt)}</td>
                    <td><Switch checked={a.canAgentControl} disabled aria-label="سماح للوكيل" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
        <p className="mt-4 text-xs text-muted-foreground">صلاحيات التحكم معطلة افتراضياً وتتطلب الخادم المحلي لتفعيلها.</p>
      </Panel>
    </>
  );
}
