/**
 * Knowledge is stored in local PostgreSQL only. Hosted Lovable previews have
 * no personal data, no localStorage sample records, and no fake writes.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, MOCK_MODE } from "./api/client";
import type { KnowledgeItem } from "./api/types";

type Draft = Pick<KnowledgeItem, "category" | "title" | "body" | "tags">;

export function useKnowledge() {
  const qc = useQueryClient();
  const real = useQuery({
    queryKey: ["knowledge"], queryFn: api.knowledge, enabled: !MOCK_MODE, retry: 0,
  });
  const refresh = async () => { if (!MOCK_MODE) await qc.invalidateQueries({queryKey:["knowledge"]}); };
  const run = useCallback(async (fn:()=>Promise<unknown>): Promise<boolean>=>{
    if (MOCK_MODE) {
      toast.error("هذه معاينة بلا بيانات. شغّل الخدمات المحلية لحفظ المعلومات.");
      return false;
    }
    try {
      await fn();
      await qc.invalidateQueries({queryKey:["knowledge"]});
      return true;
    } catch(e) {
      toast.error("تعذر حفظ المعلومات: "+(e instanceof Error?e.message:"خطأ غير معروف"));
      return false;
    }
  },[qc]);
  const create=useCallback(async(d:Draft)=>run(()=>api.knowledgeCreate(d)),[run]);
  const update=useCallback(async(id:string,d:Draft)=>{
    const prior=real.data?.find(it=>it.id===id);
    return prior ? run(()=>api.knowledgeUpdate(id,d,prior.version)) : false;
  },[real.data,run]);
  const restore=useCallback(async(id:string,version:number)=>{
    const prior=real.data?.find(it=>it.id===id);
    return prior ? run(()=>api.knowledgeRestore(id,version,prior.version)) : false;
  },[real.data,run]);
  const remove=useCallback(async(id:string)=>run(()=>api.knowledgeDelete(id)),[run]);
  return {
    items: MOCK_MODE ? [] as KnowledgeItem[] : real.data??null,
    create,update,restore,remove,refresh,
    error: MOCK_MODE ? null : real.error,
    loading: !MOCK_MODE && real.isPending,
  };
}
