import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, ApiError, getLocalToken, MOCK_MODE } from "@/lib/api/client";
import { isLocalBrowserOrigin } from "@/lib/api/origin";
import { evaluateLocalReadiness, type ReadinessInput } from "@/lib/local-readiness";
import { Button } from "@/components/ui/button";
import { Panel, Pill } from "./ui-bits";

/** Read-only, no uploads or extra privileged API calls. */
export function LocalReadiness() {
  const qc=useQueryClient();
  const [local,setLocal]=useState(false);
  const [hasToken,setHasToken]=useState(false);
  useEffect(()=>{
    const sync=()=>{
      setLocal(isLocalBrowserOrigin());
      setHasToken(Boolean(getLocalToken()));
    };
    sync();
    window.addEventListener("paw-token-updated",sync);
    return ()=>window.removeEventListener("paw-token-updated",sync);
  },[]);
  const canProbe=local&&!MOCK_MODE;
  const health=useQuery({
    queryKey:["health"],queryFn:api.health,
    enabled:canProbe,retry:0,refetchInterval:15000,
  });
  const models=useQuery({
    queryKey:["models"],queryFn:api.models,
    enabled:canProbe&&hasToken,retry:0,refetchInterval:20000,
  });
  const status=useQuery({
    queryKey:["agentStatus"],queryFn:api.agentStatus,
    enabled:canProbe&&hasToken,retry:0,refetchInterval:20000,
  });
  const auth:ReadinessInput["auth"]=!hasToken?"pending"
    : [models.error,status.error].some((e)=>e instanceof ApiError&&e.status===401)?"rejected"
    : status.data?.snapshot?"verified"
    : status.error?"unreachable":"pending";
  const findings=useMemo(()=>evaluateLocalReadiness({
    mock:MOCK_MODE,
    localOrigin:local,
    tokenPresent:hasToken,
    health:health.data,
    healthError:Boolean(health.error),
    auth,installedModels:models.data?.models.length,
  }),[local,hasToken,health.data,health.error,auth,models.data]);
  const loading=canProbe&&(health.isPending || (hasToken&&status.isPending));
  function refresh(){
    if(!canProbe)return;
    void Promise.allSettled([
      qc.invalidateQueries({queryKey:["health"]}),
      qc.invalidateQueries({queryKey:["models"]}),
      qc.invalidateQueries({queryKey:["agentStatus"]}),
    ]);
  }
  return (
    <Panel title="فحص جاهزية الخدمات المحلية" actions={
      <Button size="sm" variant="outline" disabled={!canProbe||health.isFetching}
        onClick={refresh}><RefreshCw className="me-1 size-4"/>تحديث الفحص</Button>
    }>
      <p className="mb-3 text-xs text-muted-foreground">
        قراءة آمنة لحالة الخدمات ونماذج Ollama فقط، دون تنفيذ أي مهمة أو عرض رموز الوصول أو الوصول لحساباتك.
      </p>
      {loading ? <p role="status" className="text-sm text-muted-foreground">جارٍ التحقق من خدمات الجهاز…</p> :
        <ul className="space-y-3">
          {findings.map((item)=>(
            <li key={item.id} className="rounded-md border p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill tone={item.level==="good"?"success":item.level==="error"?"danger":"warning"}>
                  {item.level==="good"?"جاهز":item.level==="error"?"يتطلب إصلاحًا":"تنبيه"}
                </Pill>
                <strong className="text-sm">{item.title}</strong>
              </div>
              <p className="text-xs leading-6 text-muted-foreground">{item.detail}</p>
            </li>
          ))}
        </ul>}
      {canProbe && <p className="mt-3 text-xs text-muted-foreground">
        تشغيل نموذج حقيقي وفحص بيئة Windows يتمان بأمر diagnose.ps1 على جهازك فقط؛ هذه اللوحة لا تشغل النموذج تلقائيًا.
      </p>}
    </Panel>
  );
}
