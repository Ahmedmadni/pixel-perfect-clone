import { createServer } from "node:http";
import { connect } from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { canOperate, validHandoff, validateBrowserUrl, agentOrigin, validateScopedAgentUrl, safeNavigationLink, safeTextControl } from "./policy.mjs";

const token = process.env.BROWSER_WORKER_TOKEN ?? "";
if (token.length < 32) throw new Error("BROWSER_WORKER_TOKEN must be at least 32 characters");
const profileDir = process.env.BROWSER_PROFILE_DIR ?? "/home/pwuser/browser-data/default";
const allowedDomains = (process.env.BROWSER_AGENT_DOMAINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const port = Number(process.env.BROWSER_WORKER_PORT ?? "4300");
const display = process.env.DISPLAY ?? ":99";
const enableReadOnlyAgent = process.env.BROWSER_ENABLE_READONLY_AGENT === "true";
const trustedCiSmoke = process.env.BROWSER_CI_TRUSTED_SMOKE === "true";
if (trustedCiSmoke && (enableReadOnlyAgent || allowedDomains.length > 0)) {
  throw new Error("Trusted CI smoke mode forbids agent use and external domain approvals");
}

let mode = "STOPPED"; // Fail-closed on every start/restart.
let generation = 0;
let context;
let activePage = null;
let agentScope = null; // Only the selected tab and exact HTTPS origin
let ciProfileRecovered = false;
const ids = new WeakMap();
let queue = Promise.resolve();

function requireToken(value) {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const a = Buffer.from(value.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, code, value) {
  if (res.headersSent) return;
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

async function bodyJson(req) {
  const chunks = [];
  let len = 0;
  for await (const chunk of req) {
    len += chunk.length;
    if (len > 16_384) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("bad_json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad_json");
  return parsed;
}

function vncViewOnly(value) {
  // This toggles INPUT at the VNC SERVER (not a cosmetic iframe overlay).
  // Fail closed: no change of ownership if x11vnc cannot acknowledge it.
  execFileSync("x11vnc", ["-display", display, "-R", value ? "viewonly" : "noviewonly"], {
    timeout: 4000, stdio: "pipe", env: { ...process.env, DISPLAY: display },
  });
}

function serialize(fn) {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}

function pages() {
  return context.pages().filter((p) => !p.isClosed());
}

function idOf(page) {
  let value = ids.get(page);
  if (!value) { value = randomUUID(); ids.set(page, value); }
  return value;
}

function findPage(id) {
  const p = pages().find((x) => idOf(x) === id);
  if (!p) throw new Error("unknown_tab");
  return p;
}

async function tabStates() {
  const list = pages();
  return Promise.all(list.map(async (p, i) => ({
    id: idOf(p),
    title: (await p.title().catch(() => "")) || "Browser tab",
    url: p.url(),
    profileId: "local-default",
    active: p === activePage,
  })));
}

function browserHealth() {
  return {
    ready: Boolean(context), mode, viewOnly: mode !== "MANUAL",
    tabs: context ? pages().length : 0,
    agentRunnerReady: enableReadOnlyAgent && Boolean(context) && !trustedCiSmoke,
    // A disposable dummy cookie is exposed as a boolean ONLY to explicitly opted-in offline CI.
    ...(trustedCiSmoke ? { ciProfileRecovered } : {}),
  };
}

async function setMode(target, tabId = null) {
  if (!validHandoff(mode, target)) throw new Error("invalid_handoff");
  // Mark pending agent work invalid BEFORE changing VNC's keyboard/mouse lock.
  if (target === "AGENT_ACTIVE" && mode === "MANUAL") {
    const tab = tabId ? findPage(tabId) : null;
    if (!tab || tab !== activePage) throw new Error("agent_tab_not_selected");
    const origin = agentOrigin(tab.url());
    if (allowedDomains.length) validateBrowserUrl(tab.url(), true, allowedDomains);
    agentScope = {tabId, origin};
  }
  if (target === "MANUAL" || target === "STOPPED") agentScope = null;
  generation++;
  if (target === "MANUAL") {
    vncViewOnly(false);
  } else {
    try {
      vncViewOnly(true);
    } catch (error) {
      mode = "STOPPED";
      agentScope = null;
      throw error;
    }
  }
  mode = target;
  return browserHealth();
}

async function operation(data, actor, action) {
  if (!canOperate(mode, actor, action)) throw new Error("control_not_owned");
  if (actor === "agent" && !enableReadOnlyAgent) throw new Error("agent_disabled");
  const generationAtStart = generation;
  const page = data.tabId ? findPage(data.tabId) : pages().at(-1);
  if (!page && action !== "new") throw new Error("no_tab");
  if (actor === "agent") {
    if (!agentScope || !data.tabId || agentScope.tabId !== data.tabId || page !== activePage)
      throw new Error("agent_tab_not_selected");
    validateScopedAgentUrl(page.url(), agentScope.origin);
  }
  if (action === "new") {
    const p = await context.newPage();
    await p.bringToFront();
    activePage = p;
    return { tabId: idOf(p) };
  }
  if (action === "activate") {
    await page.bringToFront();
    activePage = page;
    return { tabId: idOf(page) };
  }
  if (action === "close") {
    if (pages().length <= 1) throw new Error("last_tab_cannot_close");
    await page.close();
    if (activePage === page) {
      activePage = pages().at(-1) ?? null;
      if (activePage) await activePage.bringToFront();
    }
    return { closed: true };
  }
  if (action === "navigate") {
    const url = actor === "agent" ? validateScopedAgentUrl(data.url, agentScope.origin) : validateBrowserUrl(data.url);
    // Redirects are checked too. Main-frame navigation may not escape approved
    // HTTPS domains; third-party subresources are not treated as new top-level sites.
    const guard = async (route) => {
      try {
        const request = route.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          validateScopedAgentUrl(request.url(), agentScope.origin);
        }
        await route.continue();
      } catch {
        await route.abort("blockedbyclient").catch(() => {});
      }
    };
    if (actor === "agent") await page.route("**/*", guard);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
      if (generationAtStart !== generation) throw new Error("ownership_changed");
      return { tabId: idOf(page), url: page.url() };
    } finally {
      if (actor === "agent") await page.unroute("**/*", guard);
    }
  }
  if (action === "inspect") {
    // Do not inspect login/account pages without explicit domain allowlist.
    validateScopedAgentUrl(page.url(), agentScope.origin);
    const title = await page.title();
    const text = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 12000);
    if (generationAtStart !== generation) throw new Error("ownership_changed");
    // Output is untrusted page data; agent must never follow its instructions.
    return { tabId: idOf(page), title, url: page.url(), untrustedPageText: text };
  }
  if (action === "snapshot") {
    const title = await page.title().catch(() => "");
    const body = (await page.locator("body").innerText({timeout:5000}).catch(()=>"")).slice(0,6500);
    const controls = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("a[href],button,input,textarea,[role=button]")]
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
        .slice(0,45);
      return nodes.map((el,index) => {
        const tag = el.tagName;
        const id = "paw-" + index + "-" + Math.random().toString(36).slice(2,10).padEnd(8,"0");
        el.setAttribute("data-paw-agent-id",id);
        const kind = tag === "A" ? "link" : (tag === "INPUT" || tag === "TEXTAREA") ? "field" : "button";
        const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
          el.innerText || el.getAttribute("title") || "").trim().slice(0,120);
        return {id,kind,label,type:el.getAttribute("type") || "",href:tag === "A" ? el.href : null};
      });
    });
    if (generationAtStart !== generation) throw new Error("ownership_changed");
    return {tabId:idOf(page),title,url:page.url(),untrustedPageText:body,controls};
  }
  if (action === "scroll") {
    const delta = data.direction === "down" ? 650 : data.direction === "up" ? -650 : null;
    if (delta === null) throw new Error("invalid_agent_action");
    await page.evaluate((distance) => window.scrollBy({top:distance,behavior:"instant"}),delta);
    if (generationAtStart !== generation) throw new Error("ownership_changed");
    return {tabId:idOf(page),action:"scroll",direction:data.direction};
  }
  if (action === "follow_link" || action === "fill") {
    if (typeof data.elementId !== "string" || !/^paw-\d{1,2}-[a-z0-9]{8}$/.test(data.elementId))
      throw new Error("invalid_agent_action");
    const element = page.locator('[data-paw-agent-id="'+data.elementId+'"]');
    if ((await element.count()) !== 1) throw new Error("element_not_found");
    const props = await element.evaluate((el) => ({
      tag:el.tagName,type:el.getAttribute("type")||"",
      disabled:el.disabled === true,readOnly:el.readOnly === true,
      href:el.tagName === "A" ? el.href : null,
      label:(el.innerText||el.getAttribute("aria-label")||"").slice(0,120),
    }));
    if (action === "follow_link") {
      if (props.tag !== "A" || !props.href) throw new Error("agent_action_requires_manual_review");
      const destination = safeNavigationLink(props.href,props.label,agentScope.origin);
      const guard = async (route) => {
        try {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === page.mainFrame())
            validateScopedAgentUrl(request.url(), agentScope.origin);
          await route.continue();
        } catch { await route.abort("blockedbyclient").catch(()=>{}); }
      };
      await page.route("**/*",guard);
      try { await page.goto(destination,{waitUntil:"domcontentloaded",timeout:12000}); }
      finally { await page.unroute("**/*",guard); }
      if (generationAtStart !== generation) throw new Error("ownership_changed");
      validateScopedAgentUrl(page.url(),agentScope.origin);
      return {tabId:idOf(page),action:"follow_link",url:page.url()};
    }
    if (!safeTextControl(props.tag,props.type,props.disabled,props.readOnly))
      throw new Error("agent_action_requires_manual_review");
    if (typeof data.text !== "string" || data.text.length > 500) throw new Error("invalid_agent_action");
    await element.fill(data.text,{timeout:5000});
    if (generationAtStart !== generation) throw new Error("ownership_changed");
    validateScopedAgentUrl(page.url(),agentScope.origin);
    return {tabId:idOf(page),action:"fill",field:props.label};
  }
  throw new Error("unsupported_operation");
}

async function isNoVncListening() {
  return await new Promise((resolve) => {
    const socket = connect({host: "127.0.0.1", port: 6080});
    const finish = (ready) => { socket.destroy(); resolve(ready); };
    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function handle(req, res) {
  // This worker is a private BACKEND-TO-BACKEND service, never a browser-facing API.
  if (req.headers.origin) return json(res, 403, { error: "origin_forbidden" });
  if (!requireToken(req.headers.authorization)) return json(res, 401, { error: "unauthorized" });
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && pathname === "/health") return json(res, 200, {...browserHealth(), novnc: await isNoVncListening()});
  if (req.method === "GET" && pathname === "/tabs") return json(res, 200, await tabStates());

  if (req.method !== "POST") return json(res, 404, { error: "unknown_route" });
  const data = await bodyJson(req);
  if (pathname === "/control") {
    if (data.state === "AGENT_ACTIVE" && !enableReadOnlyAgent) return json(res, 409, { error: "agent_disabled" });
    if (typeof data.state !== "string") return json(res, 400, { error: "invalid_control" });
    // For STOP, apply immediately; don't wait for a pending read-only agent task.
    return json(res, 200, await setMode(data.state, data.tabId));
  }
  const commands = {
    "/tabs/new": ["user", "new"],
    "/tabs/activate": ["user", "activate"],
    "/tabs/close": ["user", "close"],
    "/tabs/navigate": ["user", "navigate"],
    "/agent/inspect": ["agent", "inspect"],
    "/agent/navigate": ["agent", "navigate"],
    "/agent/snapshot": ["agent", "snapshot"],
    "/agent/scroll": ["agent", "scroll"],
    "/agent/follow-link": ["agent", "follow_link"],
    "/agent/fill": ["agent", "fill"],
  };
  const tuple = commands[pathname];
  if (!tuple) return json(res, 404, { error: "unknown_route" });
  // Re-check authorization from mode INSIDE the serialized operation, not before.
  const value = await serialize(() => operation(data, tuple[0], tuple[1]));
  return json(res, 200, value);
}

const server = createServer((req, res) => {
  void handle(req, res).catch((e) => {
    const error = String(e?.message ?? "worker_error");
    const denied = /^(control_not_owned|invalid_handoff|agent_disabled|agent_domain_not_approved|agent_requires_https|ownership_changed|agent_private_domain_forbidden|agent_left_selected_site|agent_tab_not_selected|agent_action_requires_manual_review)$/.test(error);
    const invalid = /^(invalid_url|bad_json|body_too_large|unknown_tab|no_tab|last_tab_cannot_close|invalid_agent_action|element_not_found)$/.test(error);
    json(res, denied ? 409 : invalid ? 400 : 503, { error: denied || invalid ? error : "browser_worker_unavailable" });
  });
});

async function start() {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false, viewport: null, acceptDownloads: false,
    // In production keep Chromium's internal sandbox enabled. The throwaway
    // GitHub CI smoke session cannot create user namespaces under Ubuntu AppArmor;
    // ONLY the explicit network-denied CI mode tests VNC/GUI without the sandbox.
    chromiumSandbox: !trustedCiSmoke, args: ["--disable-dev-shm-usage"],
  });
  if (trustedCiSmoke) {
    // CI browser may render about:blank for smoke checks but must not fetch remote websites.
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
  }
  if (trustedCiSmoke) {
    // Offline profile persistence smoke: use a synthetic .test cookie, never a real login.
    const domain = "https://paw-profile-smoke.test";
    const existing = await context.cookies(domain);
    ciProfileRecovered = existing.some((c) =>
      c.name === "paw_ci_test_marker" && c.value === "offline-test-data");
    if (!ciProfileRecovered) {
      await context.addCookies([{
        url: domain, name: "paw_ci_test_marker", value: "offline-test-data",
        sameSite: "Lax", secure: true, httpOnly: true,
        // Persistent test cookie, not a session-only cookie that browsers discard on exit.
        expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      }]);
    }
  }
  context.on("page",(tab)=>{
    if (mode === "AGENT_ACTIVE") void tab.close().catch(()=>{});
  });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(12_000);
  if (!pages().length) await context.newPage();
  activePage = pages().at(-1) ?? null;
  // Force server-side read-only input at every startup.
  vncViewOnly(true);
  server.listen(port, "0.0.0.0", () => console.log("Local browser worker ready"));
}
await start();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    generation++;
    mode = "STOPPED";
    try { vncViewOnly(true); } catch {}
    server.close();
    void context?.close().finally(() => process.exit(0));
  });
}
