import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { api, MOCK_MODE, type ChatStreamEvent } from "@/lib/api/client";
import type { ChatMessage, TaskStatus } from "@/lib/api/types";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, Pill, QueryState, type Tone } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/chat")({
  head: pageHead("المحادثة والمهام", "Local Ollama model, streamed responses and task status."),
  component: ChatPage,
});

const taskMeta: Record<TaskStatus, { l: string; t: Tone }> = {
  queued: { l: "في الطابور", t: "neutral" },
  running: { l: "قيد التنفيذ", t: "primary" },
  awaiting_approval: { l: "بانتظار موافقة", t: "warning" },
  done: { l: "مكتملة", t: "success" },
  failed: { l: "فشلت", t: "danger" },
  cancelled: { l: "أُلغيت", t: "neutral" },
};

function ChatPage() {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["chat"], queryFn: api.chatHistory, retry: 0 });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models, retry: 0, refetchInterval: 30000 });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks, retry: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!busy && history.data) setMessages(history.data);
  }, [history.data, busy]);

  useEffect(() => {
    const available = models.data?.models ?? [];
    if (available.length && !available.some((m) => m.name === selected)) setSelected(available[0]!.name);
  }, [models.data, selected]);

  useEffect(() => { viewRef.current?.scrollTo({ top: viewRef.current.scrollHeight }); }, [messages]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  function applyEvent(event: ChatStreamEvent) {
    if (event.type === "user" || event.type === "assistant_start" || event.type === "done") {
      setMessages((list) => {
        const pos = list.findIndex((m) => m.id === event.message.id);
        if (pos >= 0) return list.map((m) => m.id === event.message.id ? event.message : m);
        return [...list, event.message];
      });
    } else if (event.type === "delta") {
      setMessages((list) => {
        const copy = [...list];
        let pos = -1;
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i]?.role === "assistant" && copy[i]?.status === "streaming") { pos = i; break; }
        }
        const previous = pos >= 0 ? copy[pos] : undefined;
        if (previous) copy[pos] = { ...previous, content: previous.content + event.text };
        return copy;
      });
    } else if (event.type === "error") {
      setError(event.error);
    }
  }

  async function submit(content: string) {
    if (busy || !content.trim() || !selected || MOCK_MODE) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setError(null);
    setBusy(true);
    try {
      await api.streamChat(content.trim(), selected, applyEvent, ctl.signal);
      setText("");
    } catch (e) {
      setError(ctl.signal.aborted ? "تم إيقاف التوليد." : e instanceof Error ? e.message : "فشل الاتصال بالنموذج المحلي");
    } finally {
      setBusy(false);
      abortRef.current = null;
      void qc.invalidateQueries({ queryKey: ["chat"] });
    }
  }

  return (
    <>
      <PageHeader title="المحادثة والمهام" desc="محادثة محلية حقيقية باستخدام Ollama، بدون اشتراك في API مدفوع." />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="flex flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b pb-3">
            <label className="text-sm" htmlFor="model-choice">النموذج المحلي</label>
            <select
              id="model-choice"
              dir="ltr"
              className="min-w-44 rounded-md border bg-background px-3 py-2 text-sm"
              value={selected}
              disabled={busy || MOCK_MODE || models.isPending || !!models.error}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">اختر النموذج</option>
              {models.data?.models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
            <Pill tone={MOCK_MODE ? "warning" : models.error ? "danger" : selected ? "success" : "neutral"}>
              {MOCK_MODE ? "تجريبي" : models.error ? "Ollama غير متصل" : selected ? "نموذج متاح" : "لا توجد نماذج"}
            </Pill>
          </div>
          {!MOCK_MODE && models.error && (
            <p className="mb-3 text-sm text-destructive">فشل اكتشاف Ollama: {models.error.message}. شغّل Ollama على الكمبيوتر وتأكد من رمز الخادم المحلي.</p>
          )}
          {!MOCK_MODE && !models.isPending && !models.error && (models.data?.models.length ?? 0) === 0 && (
            <p className="mb-3 text-sm text-muted-foreground">لا توجد نماذج مثبتة. جرّب تنفيذ ollama pull llama3.2 على جهازك.</p>
          )}
          <div ref={viewRef} className="h-[55vh] space-y-3 overflow-y-auto">
            {history.isPending && messages.length === 0 ? <p className="text-sm text-muted-foreground">جاري تحميل المحادثة…</p> : null}
            {history.error && messages.length === 0 ? <p className="text-sm text-destructive">تعذر تحميل السجل: {history.error.message}</p> : null}
            {messages.length === 0 && !history.isPending && !history.error ? <p className="text-sm text-muted-foreground">ابدأ محادثة بعد الاتصال بالنموذج المحلي.</p> : null}
            {messages.map((m) => (
              <div key={m.id} className={`max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-4 py-2.5 text-sm ${m.role === "user" ? "ms-auto bg-primary text-primary-foreground" : m.role === "system" ? "mx-auto bg-muted text-xs text-muted-foreground" : "bg-secondary"}`}>
                {m.content || (m.status === "streaming" ? "جارٍ توليد الرد…" : "")}
                {(m.status === "aborted" || m.status === "failed") && <p className="mt-2 text-xs opacity-70">{m.status === "aborted" ? "تم الإيقاف" : "لم يكتمل الرد"}</p>}
              </div>
            ))}
          </div>
          <form
            className="mt-4 flex gap-2 border-t pt-4"
            onSubmit={(e) => { e.preventDefault(); void submit(text); }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك…" rows={2} className="resize-none" disabled={busy || MOCK_MODE} />
            {busy ? (
              <Button type="button" variant="destructive" onClick={() => abortRef.current?.abort()} title="إيقاف التوليد"><Square className="size-4" /></Button>
            ) : (
              <Button type="submit" disabled={!text.trim() || !selected || MOCK_MODE || !!models.error} title="إرسال"><Send className="size-4" /></Button>
            )}
          </form>
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          {MOCK_MODE && <p className="mt-2 text-xs text-warning">الوضع التجريبي — لا يتم إرسال الرسائل إلى أي نموذج حقيقي.</p>}
        </Panel>
        <Panel title="المهام">
          <QueryState q={tasks}>
            {(ts) => (
              <ul className="divide-y">
                {ts.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <span>{t.title}</span>
                    <Pill tone={taskMeta[t.status].t}>{taskMeta[t.status].l}</Pill>
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
