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
  if (actor === "agent") return state === "AGENT_ACTIVE" &&
    ["inspect", "snapshot", "navigate", "scroll", "follow_link", "fill"].includes(operation);
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

/**
 * A single user-selected tab is the authorization scope. Never let the agent
 * navigate to another origin, local services, IP addresses or intranet hosts.
 * Manual browsing is deliberately not subject to this agent-only restriction.
 */
export function agentOrigin(value) {
  const parsed = new URL(validateBrowserUrl(value));
  const host = parsed.hostname.toLowerCase().replace(/\.$/,"");
  if (parsed.protocol !== "https:" || parsed.port && parsed.port !== "443") throw new Error("agent_requires_https");
  if (!host.includes(".") || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(host) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":") ||
    host.endsWith(".test")) throw new Error("agent_private_domain_forbidden");
  return parsed.origin;
}
export function validateScopedAgentUrl(value, origin) {
  const url = new URL(validateBrowserUrl(value));
  if (agentOrigin(value) !== origin) throw new Error("agent_left_selected_site");
  if (url.origin !== origin) throw new Error("agent_left_selected_site");
  return url.href;
}
export function safeNavigationLink(value, label, origin) {
  const href = validateScopedAgentUrl(value, origin);
  // GET links may mutate state on poorly-designed websites. Deny suspicious
  // labels, path segments and query parameters rather than allowing blind clicks.
  const text = decodeURIComponent(href).toLowerCase()+" "+String(label).toLowerCase();
  if (/(logout|sign.?out|delete|remove|destroy|unsubscribe|purchase|checkout|payment|pay\b|order\b|submit|post\b|send\b|confirm|cancel|transfer|withdraw|approve|reject|إرسال|حذف|شراء|دفع|نشر|إلغاء|تأكيد)/i.test(text)) {
    throw new Error("agent_action_requires_manual_review");
  }
  return href;
}
export function safeTextControl(tag, type, disabled, readOnly) {
  return !disabled && !readOnly && (
    tag==="TEXTAREA" || (tag==="INPUT" && ["text","search"].includes(String(type).toLowerCase()))
  );
}
