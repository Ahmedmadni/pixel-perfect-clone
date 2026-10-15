/**
 * Pure policy helpers shared by the worker and its unit tests.
 * Browsing is user-initiated; agent navigation requires explicit allowlisting.
 */
export function validateBrowserUrl(value, forAgent = false, allowedDomains = []) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("invalid_url");
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid_url"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_url");
  if (forAgent) {
    if (url.protocol !== "https:") throw new Error("agent_requires_https");
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const allowed = allowedDomains.some((d) => {
      const domain = d.trim().toLowerCase().replace(/\.$/, "");
      return domain.length > 0 && (host === domain || host.endsWith("." + domain));
    });
    if (!allowed) throw new Error("agent_domain_not_approved");
  }
  return url.href;
}

export function canOperate(state, actor, operation) {
  if (actor === "user") return state === "MANUAL" && ["new", "activate", "navigate", "close"].includes(operation);
  if (actor === "agent") return state === "AGENT_ACTIVE" && ["inspect", "navigate"].includes(operation);
  return false;
}

export const WORKER_STATES = ["MANUAL", "AGENT_ACTIVE", "PAUSED", "STOPPED"];
export function validHandoff(from, to) {
  if (!WORKER_STATES.includes(to)) return false;
  if (to === "STOPPED") return true;
  if (from === "STOPPED") return to === "MANUAL";
  if (from === "MANUAL") return to === "AGENT_ACTIVE";
  if (from === "AGENT_ACTIVE") return to === "PAUSED" || to === "MANUAL";
  if (from === "PAUSED") return to === "AGENT_ACTIVE" || to === "MANUAL";
  return false;
}
