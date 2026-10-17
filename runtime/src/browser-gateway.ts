/**
 * Private Fastify -> Browser Worker bridge.
 * No browser-worker token, URL, or VNC password is ever exposed to the frontend.
 */
export interface WorkerHealth {
  ready: boolean;
  mode: "MANUAL" | "AGENT_ACTIVE" | "PAUSED" | "STOPPED";
  viewOnly: boolean;
  tabs: number;
  novnc: boolean;
  agentRunnerReady: boolean;
}
export interface WorkerTab {
  id: string;
  title: string;
  url: string;
  profileId: string;
  active: boolean;
}
export class BrowserWorkerUnavailable extends Error {}

export class BrowserGateway {
  constructor(private readonly baseUrl: string, private readonly token: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.username || url.password) {
      throw new Error("Browser worker must be a loopback HTTP service");
    }
    if (token.length < 32) throw new Error("Browser worker bearer token missing");
  }

  private async call<T>(route: string, body?: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(route, this.baseUrl), {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BrowserWorkerUnavailable("Local browser worker unreachable");
    }
    if (!response.ok) {
      let message = "browser_worker_error";
      try { message = String(((await response.json()) as {error?: string}).error ?? message).slice(0,120); }
      catch { /* no JSON body */ }
      throw new BrowserWorkerUnavailable(message);
    }
    try { return (await response.json()) as T; }
    catch { throw new BrowserWorkerUnavailable("Invalid browser-worker response"); }
  }
  health() { return this.call<WorkerHealth>("/health"); }
  tabs() { return this.call<WorkerTab[]>("/tabs"); }
  async handoff(state: WorkerHealth["mode"], tabId?: string) {
    const snapshot = await this.health();
    if (!snapshot.ready) throw new BrowserWorkerUnavailable("Chromium not ready");
    if (snapshot.mode === state) return snapshot;
    return this.call<WorkerHealth>("/control", { state, ...(tabId ? {tabId} : {}) });
  }
  async ensureManual() {
    const state = await this.health();
    if (!state.ready) throw new BrowserWorkerUnavailable("Chromium not ready");
    if (state.mode === "STOPPED") await this.handoff("MANUAL");
    else if (state.mode !== "MANUAL") throw new BrowserWorkerUnavailable("Browser is not under manual control");
  }
  newTab() { return this.call<{tabId: string}>("/tabs/new", {}); }
  activateTab(tabId: string) { return this.call<{tabId: string}>("/tabs/activate", {tabId}); }
  closeTab(tabId: string) { return this.call<{closed: boolean}>("/tabs/close", {tabId}); }
  navigate(tabId: string, url: string) { return this.call<{tabId: string; url: string}>("/tabs/navigate", {tabId, url}); }
  /** Scope-safe, non-destructive browser controls for the exact user-selected tab. */
  snapshot(tabId: string) {
    return this.call<{
      tabId:string; title:string; url:string; untrustedPageText:string;
      controls:{id:string;kind:"link"|"field"|"button";label:string;type:string;href:string|null}[];
    }>("/agent/snapshot",{tabId});
  }
  agentAction(tabId:string, action:
    | {action:"scroll";direction:"up"|"down"}
    | {action:"follow_link";elementId:string}
    | {action:"fill";elementId:string;text:string}
    | {action:"navigate";url:string},
  ) {
    const paths={scroll:"/agent/scroll",follow_link:"/agent/follow-link",fill:"/agent/fill",navigate:"/agent/navigate"};
    return this.call<{tabId:string;action?:string;url?:string}>(paths[action.action],{tabId,...action});
  }
  /** Reads only an explicitly allowed HTTPS page. The worker rechecks both ownership and domain. */
  inspect(tabId: string) {
    return this.call<{ tabId: string; title: string; url: string; untrustedPageText: string }>(
      "/agent/inspect", { tabId },
    );
  }
}
