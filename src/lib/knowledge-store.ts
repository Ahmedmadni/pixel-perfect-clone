/**
 * Phase 2D: real mode uses the authenticated local PostgreSQL API; mock mode
 * keeps explicitly labelled localStorage demo data. Never mix the two stores.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, MOCK_MODE } from "./api/client";
import type { KnowledgeCategory, KnowledgeItem } from "./api/types";

const KEY = "paw.knowledge.v1";
type Draft = Pick<KnowledgeItem, "category" | "title" | "body" | "tags">;

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

function loadMock(): KnowledgeItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KnowledgeItem[]) : seed();
  } catch { return seed(); }
}

export function useKnowledge() {
  const qc = useQueryClient();
  const [demo, setDemo] = useState<KnowledgeItem[] | null>(null);
  const real = useQuery({ queryKey: ["knowledge"], queryFn: api.knowledge, enabled: !MOCK_MODE, retry: 0 });

  useEffect(() => { if (MOCK_MODE) setDemo(loadMock()); }, []);
  useEffect(() => { if (MOCK_MODE && demo) window.localStorage.setItem(KEY, JSON.stringify(demo)); }, [demo]);

  const items = MOCK_MODE ? demo : real.data ?? null;
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["knowledge"] }); };
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["knowledge"] });
      return true;
    } catch (e) {
      toast.error("تعذر حفظ المعلومات في قاعدة البيانات المحلية: " + (e instanceof Error ? e.message : "خطأ غير معروف"));
      await qc.invalidateQueries({ queryKey: ["knowledge"] });
      return false;
    }
  }, [qc]);

  const create = useCallback(async (d: Draft): Promise<boolean> => {
    if (MOCK_MODE) {
      const at = new Date().toISOString();
      setDemo((cur) => [
        { ...d, id: crypto.randomUUID(), version: 1, updatedAt: at, history: [{ version: 1, title: d.title, body: d.body, at }] },
        ...(cur ?? []),
      ]);
      return true;
    }
    return run(() => api.knowledgeCreate(d));
  }, [run]);

  const update = useCallback(async (id: string, d: Draft): Promise<boolean> => {
    if (MOCK_MODE) {
      const at = new Date().toISOString();
      setDemo((cur) => (cur ?? []).map((it) => {
        if (it.id !== id) return it;
        const version = it.version + 1;
        return { ...it, ...d, version, updatedAt: at, history: [{ version, title: d.title, body: d.body, at }, ...it.history] };
      }));
      return true;
    }
    const prior = real.data?.find((it) => it.id === id);
    if (!prior) return false;
    return run(() => api.knowledgeUpdate(id, d, prior.version));
  }, [real.data, run]);

  const restore = useCallback(async (id: string, version: number): Promise<boolean> => {
    if (MOCK_MODE) {
      setDemo((cur) => (cur ?? []).map((it) => {
        if (it.id !== id) return it;
        const v = it.history.find((h) => h.version === version);
        if (!v) return it;
        const nv = it.version + 1;
        const at = new Date().toISOString();
        return { ...it, title: v.title, body: v.body, version: nv, updatedAt: at,
          history: [{ version: nv, title: v.title, body: v.body, at }, ...it.history] };
      }));
      return true;
    }
    const prior = real.data?.find((it) => it.id === id);
    if (!prior) return false;
    return run(() => api.knowledgeRestore(id, version, prior.version));
  }, [real.data, run]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    if (MOCK_MODE) { setDemo((cur) => (cur ?? []).filter((it) => it.id !== id)); return true; }
    return run(() => api.knowledgeDelete(id));
  }, [run]);

  return {
    items, create, update, restore, remove, refresh,
    error: !MOCK_MODE ? real.error : null,
    loading: !MOCK_MODE ? real.isPending : items === null,
  };
}
