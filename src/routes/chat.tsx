import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Send } from "lucide-react";
import { api } from "@/lib/api/client";
import type { ChatMessage, TaskStatus } from "@/lib/api/types";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, Pill, QueryState, type Tone } from "@/components/workspace/ui-bits";

export const Route = createFileRoute("/chat")({
  head: pageHead("المحادثة والمهام", "Chat with the local Ollama model and manage agent tasks."),
  component: ChatPage,
});

const taskMeta: Record<TaskStatus, { l: string; t: Tone }> = {
  queued: { l: "في الطابور", t: "neutral" },
  running: { l: "قيد التنفيذ", t: "primary" },
  awaiting_approval: { l: "بانتظار موافقة", t: "warning" },
  done: { l: "مكتملة", t: "success" },
  failed: { l: "فشلت", t: "danger" },
};

function ChatPage() {
  const qc = useQueryClient();
  const chat = useQuery({ queryKey: ["chat"], queryFn: api.chatHistory });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: async (content: string) => {
      const mine: ChatMessage = { id: crypto.randomUUID(), role: "user", content, at: new Date().toISOString() };
      qc.setQueryData<ChatMessage[]>(["chat"], (c) => [...(c ?? []), mine]);
      return api.sendChat(content);
    },
    onSuccess: (reply) => qc.setQueryData<ChatMessage[]>(["chat"], (c) => [...(c ?? []), reply]),
  });

  return (
    <>
      <PageHeader title="المحادثة والمهام" desc="تحدث مع النموذج المحلي (Ollama) وتابع المهام." />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="flex flex-col">
          <div className="h-[55vh] space-y-3 overflow-y-auto">
            <QueryState q={chat} empty="ابدأ محادثة">
              {(ms) => ms.map((m) => (
                <div key={m.id} className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${m.role === "user" ? "ms-auto bg-primary text-primary-foreground" : m.role === "system" ? "mx-auto bg-muted text-xs text-muted-foreground" : "bg-secondary"}`}>
                  {m.content}
                </div>
              ))}
            </QueryState>
          </div>
          <form
            className="mt-4 flex gap-2 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              send.mutate(text.trim());
              setText("");
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك…" rows={2} className="resize-none" />
            <Button type="submit" disabled={send.isPending}><Send className="size-4" /></Button>
          </form>
          {send.error && <p className="mt-2 text-xs text-destructive">تعذر الإرسال: {send.error.message}</p>}
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
