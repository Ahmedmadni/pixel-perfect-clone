import { useMemo, useState } from "react";
import { History, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useKnowledge } from "@/lib/knowledge-store";
import type { KnowledgeCategory, KnowledgeItem } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel, Pill, fmtTime } from "./ui-bits";

export const CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  personal: "معلومات شخصية",
  instruction: "تعليمات",
  style: "أسلوب رد",
  example: "مثال رد",
};

type Draft = { category: KnowledgeCategory; title: string; body: string; tags: string };

export function KnowledgeManager({ categories }: { categories: KnowledgeCategory[] }) {
  const { items, create, update, remove, restore } = useKnowledge();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<KnowledgeCategory | "all">("all");
  const [editing, setEditing] = useState<{ id: string | null; d: Draft } | null>(null);
  const [historyOf, setHistoryOf] = useState<KnowledgeItem | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        categories.includes(i.category) &&
        (cat === "all" || i.category === cat) &&
        (!s || `${i.title} ${i.body} ${i.tags.join(" ")}`.toLowerCase().includes(s)),
    );
  }, [items, q, cat, categories]);

  const save = () => {
    if (!editing || !editing.d.title.trim()) return;
    const d = { ...editing.d, tags: editing.d.tags.split(",").map((t) => t.trim()).filter(Boolean) };
    if (editing.id) update(editing.id, d);
    else create(d);
    setEditing(null);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث في العناوين والمحتوى والوسوم…" className="ps-9" />
        </div>
        {categories.length > 1 && (
          <div className="flex gap-1">
            {(["all", ...categories] as const).map((c) => (
              <Button key={c} size="sm" variant={cat === c ? "default" : "secondary"} onClick={() => setCat(c)}>
                {c === "all" ? "الكل" : CATEGORY_LABEL[c]}
              </Button>
            ))}
          </div>
        )}
        <Button onClick={() => setEditing({ id: null, d: { category: categories[0], title: "", body: "", tags: "" } })}>
          <Plus className="size-4" /> إضافة
        </Button>
      </div>

      {items === null ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">لا توجد عناصر مطابقة.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((i) => (
            <Panel key={i.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{i.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Pill tone="primary">{CATEGORY_LABEL[i.category]}</Pill>
                    {i.tags.map((t) => <Pill key={t}>{t}</Pill>)}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">v{i.version}</span>
              </div>
              <p className="mt-3 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{i.body}</p>
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <span className="text-[11px] text-muted-foreground">{fmtTime(i.updatedAt)}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="السجل" onClick={() => setHistoryOf(i)}><History className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setEditing({ id: i.id, d: { category: i.category, title: i.title, body: i.body, tags: i.tags.join(", ") } })}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => confirm("حذف هذا العنصر؟") && remove(i.id)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "تعديل" : "عنصر جديد"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={editing.d.category}
                onChange={(e) => setEditing({ ...editing, d: { ...editing.d, category: e.target.value as KnowledgeCategory } })}
              >
                {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <Input placeholder="العنوان" value={editing.d.title} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, title: e.target.value } })} />
              <Textarea rows={6} placeholder="المحتوى" value={editing.d.body} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, body: e.target.value } })} />
              <Input placeholder="وسوم مفصولة بفواصل" value={editing.d.tags} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, tags: e.target.value } })} />
            </div>
          )}
          <DialogFooter><Button onClick={save}>حفظ</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyOf} onOpenChange={(o) => !o && setHistoryOf(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>سجل الإصدارات — {historyOf?.title}</DialogTitle></DialogHeader>
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {historyOf?.history.map((h) => (
              <li key={h.version} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">v{h.version} · {fmtTime(h.at)}</span>
                  {h.version !== historyOf.version && (
                    <Button size="sm" variant="outline" onClick={() => { restore(historyOf.id, h.version); setHistoryOf(null); }}>استعادة</Button>
                  )}
                </div>
                <div className="mt-1 font-medium">{h.title}</div>
                <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{h.body}</p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
