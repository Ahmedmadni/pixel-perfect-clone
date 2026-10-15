/**
 * Knowledge Center store. Phase 1 persists to browser localStorage (local-first,
 * no cloud). Phase 2 swaps this for /v1/knowledge on the local API (same shape).
 */
import { useCallback, useEffect, useState } from "react";
import type { KnowledgeCategory, KnowledgeItem } from "./api/types";

const KEY = "paw.knowledge.v1";

function seed(): KnowledgeItem[] {
  const now = new Date().toISOString();
  const mk = (id: string, category: KnowledgeCategory, title: string, body: string, tags: string[]): KnowledgeItem => ({
    id, category, title, body, tags, version: 1, updatedAt: now,
    history: [{ version: 1, title, body, at: now }],
  });
  return [
    mk("seed-1", "personal", "معلومات أساسية", "الاسم المفضل في الردود، المدينة، ساعات العمل المعتادة.", ["هوية"]),
    mk("seed-2", "instruction", "لا ترسل دون موافقة", "أي رسالة لجهة اتصال جديدة تتطلب موافقة صريحة قبل الإرسال.", ["أمان"]),
    mk("seed-3", "style", "أسلوب ودّي مختصر", "ردود قصيرة، ترحيب لطيف، بدون رموز تعبيرية مفرطة، لغة عربية فصحى مبسطة.", ["ردود"]),
    mk("seed-4", "example", "مثال: الرد على استفسار سعر", "سؤال: كم السعر؟\nالرد: أهلاً بك! أرسلت لك التفاصيل في الخاص 🌿", ["مبيعات"]),
  ];
}

function load(): KnowledgeItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KnowledgeItem[]) : seed();
  } catch {
    return seed();
  }
}

export function useKnowledge() {
  const [items, setItems] = useState<KnowledgeItem[] | null>(null);

  useEffect(() => setItems(load()), []);
  useEffect(() => {
    if (items) window.localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const create = useCallback((d: Pick<KnowledgeItem, "category" | "title" | "body" | "tags">) => {
    const at = new Date().toISOString();
    setItems((cur) => [
      { ...d, id: crypto.randomUUID(), version: 1, updatedAt: at, history: [{ version: 1, title: d.title, body: d.body, at }] },
      ...(cur ?? []),
    ]);
  }, []);

  const update = useCallback((id: string, d: Pick<KnowledgeItem, "category" | "title" | "body" | "tags">) => {
    const at = new Date().toISOString();
    setItems((cur) =>
      (cur ?? []).map((it) => {
        if (it.id !== id) return it;
        const version = it.version + 1;
        return { ...it, ...d, version, updatedAt: at, history: [{ version, title: d.title, body: d.body, at }, ...it.history] };
      }),
    );
  }, []);

  const restore = useCallback((id: string, version: number) => {
    setItems((cur) =>
      (cur ?? []).map((it) => {
        const v = it.history.find((h) => h.version === version);
        if (it.id !== id || !v) return it;
        const nv = it.version + 1;
        const at = new Date().toISOString();
        return { ...it, title: v.title, body: v.body, version: nv, updatedAt: at, history: [{ version: nv, title: v.title, body: v.body, at }, ...it.history] };
      }),
    );
  }, []);

  const remove = useCallback((id: string) => setItems((cur) => (cur ?? []).filter((i) => i.id !== id)), []);

  return { items, create, update, restore, remove };
}
