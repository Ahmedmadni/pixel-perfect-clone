import type { BrowserGateway } from "./browser-gateway.ts";
import type { ControlStore } from "./store.ts";

/**
 * Never inherit manual or agent browser ownership from a previous Fastify process.
 * A fresh runtime cannot trust old VNC control state, even if PostgreSQL is MANUAL.
 * BrowserGateway must be omitted from Fastify if this check cannot be completed.
 */
export async function establishSafeBrowserStartup(
  store: ControlStore,
  browser: BrowserGateway,
): Promise<void> {
  // PgControlStore.getSnapshot() internally performs its transactional startup
  // recovery: any old AGENT_ACTIVE / PAUSED state is reset to STOPPED.
  await store.getSnapshot();
  const worker = await browser.health();
  if (!worker.ready) throw new Error("Browser worker is not ready");
  if (worker.mode !== "STOPPED") {
    await browser.handoff("STOPPED");
  }
  const final = await browser.health();
  if (!final.ready || final.mode !== "STOPPED" || !final.viewOnly) {
    throw new Error("Browser failed to enter exclusive STOPPED/view-only mode");
  }
}
