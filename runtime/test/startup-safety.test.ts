import { describe, expect, it } from "vitest";
import { establishSafeBrowserStartup } from "../src/startup-safety.ts";
import type { BrowserGateway, WorkerHealth } from "../src/browser-gateway.ts";
import type { ControlStore } from "../src/store.ts";
import { initialControl } from "../../src/lib/control-machine.ts";

function environment(initialMode: WorkerHealth["mode"], opts?: {offline?: boolean; failHandoff?: boolean; brokenLock?: boolean}) {
  const events: string[] = [];
  const h: WorkerHealth = {
    ready: !opts?.offline, novnc: true, agentRunnerReady: false,
    tabs: 1, mode: initialMode, viewOnly: initialMode !== "MANUAL",
  };
  const store = {
    getSnapshot: async () => { events.push("db-recovery"); return initialControl; },
  } as ControlStore;
  const browser = {
    health: async () => {
      events.push("health");
      if (opts?.offline) throw new Error("offline");
      return {...h};
    },
    handoff: async (target: WorkerHealth["mode"]) => {
      events.push("handoff:"+target);
      if (opts?.failHandoff) throw new Error("VNC ownership lock unavailable");
      h.mode=target;
      h.viewOnly=opts?.brokenLock ? false : target !== "MANUAL";
      return {...h};
    },
  } as BrowserGateway;
  return {store,browser,events};
}

describe("runtime startup browser ownership security", () => {
  it.each(["MANUAL","AGENT_ACTIVE","PAUSED"] as const)(
    "forces old %s control to STOPPED before runtime serves browser routes",
    async (mode) => {
      const f=environment(mode);
      await establishSafeBrowserStartup(f.store,f.browser);
      expect(f.events).toEqual(["db-recovery","health","handoff:STOPPED","health"]);
    },
  );
  it("accepts already stopped and view-only worker without resetting it again",async()=>{
    const f=environment("STOPPED");
    await establishSafeBrowserStartup(f.store,f.browser);
    expect(f.events).toEqual(["db-recovery","health","health"]);
  });
  it("refuses to advertise a browser worker when VNC handoff fails",async()=>{
    const f=environment("AGENT_ACTIVE",{failHandoff:true});
    await expect(establishSafeBrowserStartup(f.store,f.browser)).rejects.toThrow("ownership lock");
  });
  it("rejects a worker that cannot prove STOPPED is view-only",async()=>{
    const f=environment("MANUAL",{brokenLock:true});
    await expect(establishSafeBrowserStartup(f.store,f.browser)).rejects.toThrow("view-only");
  });
  it("treats worker disconnection as a non-ready browser instead of continuing",async()=>{
    const f=environment("STOPPED",{offline:true});
    await expect(establishSafeBrowserStartup(f.store,f.browser)).rejects.toThrow("offline");
    expect(f.events[0]).toBe("db-recovery");
  });
});
