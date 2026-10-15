import type { ReactNode } from "react";
import { AlertTriangle, Loader2, WifiOff } from "lucide-react";
import { cva } from "class-variance-authority";
import { ApiError } from "@/lib/api/client";
import type { ControlState } from "@/lib/control-machine";
import { Button } from "@/components/ui/button";

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, actions, className = "" }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const pill = cva("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "border-border bg-muted text-muted-foreground",
      primary: "border-primary/40 bg-primary/10 text-primary",
      warning: "border-warning/40 bg-warning/10 text-warning",
      danger: "border-destructive/40 bg-destructive/10 text-destructive",
      success: "border-success/40 bg-success/10 text-success",
      info: "border-info/40 bg-info/10 text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type Tone = "neutral" | "primary" | "warning" | "danger" | "success" | "info";
export function Pill({ tone, children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={pill({ tone })}>
      {dot && <span className="pulse-dot size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const controlMeta: Record<ControlState, { label: string; tone: Tone }> = {
  MANUAL: { label: "يدوي", tone: "info" },
  AGENT_ACTIVE: { label: "الوكيل نشط", tone: "primary" },
  APPROVAL_REQUIRED: { label: "بانتظار الموافقة", tone: "warning" },
  PAUSED: { label: "متوقف مؤقتاً", tone: "neutral" },
  STOPPED: { label: "إيقاف طارئ", tone: "danger" },
  ERROR: { label: "خطأ", tone: "danger" },
};

export function ControlBadge({ state }: { state: ControlState }) {
  const m = controlMeta[state];
  return (
    <Pill tone={m.tone} dot={state === "AGENT_ACTIVE" || state === "APPROVAL_REQUIRED"}>
      <span className="font-mono text-[10px] opacity-70">{state}</span> {m.label}
    </Pill>
  );
}

/** Uniform loading / offline / error rendering for any query. */
export function QueryState<T>({
  q,
  children,
  empty = "لا توجد بيانات",
}: {
  q: { isPending: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  children: (data: T) => ReactNode;
  empty?: string;
}) {
  if (q.isPending)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
      </div>
    );
  if (q.error) {
    const offline = q.error instanceof ApiError && q.error.kind !== "http";
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-destructive">
          {offline ? <WifiOff className="size-4" /> : <AlertTriangle className="size-4" />}
          {offline ? "الخادم المحلي غير متصل" : "حدث خطأ أثناء جلب البيانات"}
        </div>
        <p className="text-muted-foreground">{(q.error as Error).message}</p>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }
  if (q.data === undefined || (Array.isArray(q.data) && q.data.length === 0))
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return <>{children(q.data)}</>;
}

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "—";
