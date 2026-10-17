import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Globe, ListChecks, Menu, OctagonX, Settings2 } from "lucide-react";
import { useControl } from "@/lib/control-context";
import { useI18n } from "@/lib/i18n";
import { api, MOCK_MODE } from "@/lib/api/client";
import { isLocalBrowserOrigin } from "@/lib/api/origin";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ControlBadge, Pill } from "./ui-bits";

const NAV = [
  {to:"/browser",name:"المتصفح والمساعد",icon:Globe},
  {to:"/reports",name:"سجل المهام",icon:ListChecks},
  {to:"/settings",name:"الإعدادات",icon:Settings2},
] as const;

function Navigation({close}:{close?:()=>void}) {
  return <nav aria-label="التنقل الرئيسي" className="flex-1 space-y-1 p-3">
    {NAV.map(({to,name,icon:Icon})=>(
      <Link key={to} to={to} onClick={close}
        className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:font-semibold">
        <Icon className="size-4" /> {name}
      </Link>
    ))}
  </nav>;
}

export function AppShell({children}:{children:ReactNode}) {
  const {snap,send,connected,pending}=useControl();
  const {lang,setLang}=useI18n();
  const [mobileOpen,setMobileOpen]=useState(false);
  const [hydrated,setHydrated]=useState(false);
  const [hosted,setHosted]=useState(false);
  const health=useQuery({queryKey:["health"],queryFn:api.health,retry:0,refetchInterval:15000});
  useEffect(()=>{setHydrated(true);setHosted(!isLocalBrowserOrigin());},[]);
  return <div data-app-ready={hydrated?"true":"false"} className="flex min-h-screen">
    <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <Link to="/browser" className="border-b border-sidebar-border px-5 py-5 text-base font-semibold">المتصفح الذكي</Link>
      <Navigation/>
      <button type="button" className="border-t p-4 text-start text-xs text-muted-foreground hover:text-foreground"
        onClick={()=>setLang(lang==="ar"?"en":"ar")}>{lang==="ar"?"English":"العربية"}</button>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      {(MOCK_MODE||hosted)&&
        <p role="status" className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
          معاينة Lovable فقط — لا توجد مواقع مفتوحة أو مهام منفذة أو حسابات متصلة. تشغيل المتصفح والمساعد يتطلب الخدمات المحلية.
        </p>}
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-3 py-3 backdrop-blur sm:px-5">
        <div className="flex items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild><Button size="icon" variant="outline" className="md:hidden" aria-label="فتح القائمة الرئيسية"><Menu className="size-4"/></Button></SheetTrigger>
            <SheetContent side={lang==="ar"?"right":"left"} className="flex w-[min(85vw,19rem)] flex-col bg-sidebar p-0" aria-describedby={undefined}>
              <SheetTitle className="border-b p-5 text-start">المتصفح الذكي</SheetTitle>
              <Navigation close={()=>setMobileOpen(false)}/>
            </SheetContent>
          </Sheet>
          <div className="min-w-0">{connected?<ControlBadge state={snap.state}/>:<Pill tone="neutral">غير متصل محليًا</Pill>}</div>
          {!MOCK_MODE && (health.data?.services.some(x=>x.name==="playwright"&&x.status==="up")?
            <Pill tone="success">المتصفح متاح</Pill>:<Pill tone="neutral">المتصفح غير جاهز</Pill>)}
        </div>
        <Button variant="destructive" size="sm" disabled={!connected||pending||snap.state==="STOPPED"||snap.state==="ERROR"}
          onClick={()=>void send({type:"EMERGENCY_STOP"})}>
          <OctagonX className="size-4"/> إيقاف فوري
        </Button>
      </header>
      <main className="min-w-0 flex-1 bg-grid p-3 sm:p-5">{children}</main>
    </div>
  </div>;
}
