# Personal AI Workspace — Windows local setup (Phase 2A + 2B)

This setup starts the API, PostgreSQL-backed controls and **local Ollama chat integration**. Phase 2C now includes a separate Chromium + Playwright + noVNC Docker service, but **none of this has been verified on the user's Windows machine**. Autonomous AI browser actions are still disabled.

## Prerequisites

- Windows 10/11, PowerShell, Git, Node.js **22 or newer** (the runtime uses Node's `process.loadEnvFile`).
- PostgreSQL (16 or newer recommended), running locally.
- Install the free Ollama application on Windows, then run `ollama pull llama3.2` in PowerShell when suitable for your hardware. Ollama must respond locally on `http://127.0.0.1:11434`.
- WSL2 is optional until Phase 2C, when we will run Chromium/noVNC.
- No paid browser or cloud service is required for Phase 2A.

## 1. Clone and install

```powershell
git clone https://github.com/Ahmedmadni/pixel-perfect-clone.git
cd pixel-perfect-clone
npm ci
cd runtime
npm ci
```

## 2. Create a dedicated local database

Open `psql` as PostgreSQL administrator and run the following SQL, substituting a strong password and keeping it private:

```sql
CREATE ROLE paw LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE paw OWNER paw;
```

If your PostgreSQL GUI runs statements inside one transaction, create the role and database separately. Never paste real credentials into GitHub or Lovable messages.

## 3. Configure runtime authentication and database

Still in the `runtime` directory:

```powershell
npm run token
```

This creates a gitignored `runtime/.env` and prints a one-time 64-character token. Edit `runtime/.env` locally:
- Set `DATABASE_URL=postgres://paw:<URL_ENCODED_PASSWORD>@127.0.0.1:5432/paw`.
- Keep `RUNTIME_HOST=127.0.0.1`, `RUNTIME_PORT=4100`.
- Keep `CORS_ORIGINS` restricted to the actual local frontend origin (e.g. `http://localhost:8080`).
- Keep `OLLAMA_URL=http://127.0.0.1:11434`. Only loopback HTTP origins are accepted.
- Never commit `.env`, send your token in chat, or expose PostgreSQL to the internet.

Run PostgreSQL migrations 001–007 (including task history and internal notifications) and start the runtime:

```powershell
npm run migrate
npm run start
```

In a separate PowerShell window, check the public health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:4100/v1/health
```

Expected **only after successful local testing**: API and PostgreSQL report `up`; Ollama reports `up` when `/api/tags` responds, or `down` otherwise; Playwright/noVNC remain `unknown`. Missing migrations or database connectivity must be fixed before starting the runtime/chat.

After starting the runtime, check that Ollama itself is available:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

The result must list installed models. The app's chat selector fetches the available models using the authenticated local Fastify API. Run `npm run migrate` after pulling changes, since Phase 2B adds `002_chat.sql`. No personal-data uploads or paid API keys are needed.

## 4. Start the local frontend

Back at the repository root (`cd ..` from `runtime`), create an untracked `.env.local` file:

```dotenv
VITE_MOCK_MODE=false
VITE_LOCAL_API_URL=http://127.0.0.1:4100
VITE_NOVNC_URL=http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
```

Then:

```powershell
npm run dev
```

Open the **local** address printed by Vite (commonly `http://localhost:8080` in Lovable sandbox setups; your machine may choose a different port). If the port differs, edit `CORS_ORIGINS` in `runtime/.env` and restart the runtime.

In the app: **الإعدادات → تفويض الخادم المحلي**. Paste the generated token there. It is retained for the browser session only and is not embedded in frontend source. After authorization the control state should load from the runtime.

**Important:** Never enter this local API secret on a publicly hosted preview or a third-party website. Use your trusted localhost frontend.

## 5. Run tests

At repository root:
```powershell
npm test
npm run build
```

In the `runtime` folder:
```powershell
npm run typecheck
npm test
```

Optional real PostgreSQL integration tests use a **separate, disposable test database**, not your production/local personal-data database:

```powershell
$env:TEST_DATABASE_URL="postgres://paw:<URL_ENCODED_PASSWORD>@127.0.0.1:5432/paw_test"
npm test
```

Read `runtime/test/pg.test.ts` before running this. Tests and migrations require appropriate database privileges. Do not configure the test runner against a personal data database.

## 6. Phase 2C: run the local Chromium + noVNC service (optional until testing)

Do not run this inside the Lovable cloud preview. On the local Windows/WSL2 computer:

1. Install Docker Desktop or a compatible local Docker Engine.
2. Copy `browser-worker/.env.example` to `browser-worker/.env` and enter:
   - `BROWSER_WORKER_TOKEN`: a fresh strong secret (at least 32 characters), separate from `RUNTIME_TOKEN`.
   - `VNC_PASSWORD`: a strong *different* password for noVNC (VNC protocol password length limitations apply).
   - `BROWSER_AGENT_DOMAINS`: leave empty for now; agent navigation must be explicitly approved later.
3. For the experimental read-only agent, explicitly set `BROWSER_ENABLE_READONLY_AGENT=true` and an approved HTTPS domain list in `BROWSER_AGENT_DOMAINS` (example: `example.org` for harmless local validation). Otherwise leave it `false` and leave domains empty. No social posting or messaging is implemented. A read-only review may be started from Browser Workspace after choosing an active tab, objective and an installed Ollama model; it stores the report locally and returns control to you.
4. From the repository root, run `docker compose -f compose.browser.yml up --build`.
5. Set **the same** `BROWSER_WORKER_TOKEN` in `runtime/.env` and keep `BROWSER_WORKER_URL=http://127.0.0.1:4300`. Restart the Fastify runtime.
6. The noVNC viewer is on `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale`. It requires the VNC password.
7. Run `npm test` from `browser-worker` for policy tests. Use `/v1/health` to check real Chromium/noVNC status from Fastify.
8. In the trusted local app, **المتصفح → الاتصال بـ noVNC**; use the tab buttons to activate manual control. The VNC server starts in view-only mode until the authorized local backend enables manual use.

If Chromium's sandbox cannot run with your host's user namespace/seccomp configuration, do not disable the sandbox silently. Stop and configure a supported restricted environment. The Microsoft Playwright Docker image is a development baseline, not a hardened production security guarantee.

Important: User-facing AI takeover remains unavailable until a real, permitted autonomous runner exists. Opening or manipulating actual social accounts via AI automation must respect the platforms' permissions and terms; no auto-posting is implemented.

## 7. What is still missing

- Phase 2B: code for Ollama discovery/streaming/history exists; **real local verification and regression tests remain pending**.
- Phase 2C: browser-worker and live-viewer integration code added; Docker/Windows and VNC security tests remain pending.
- Phase 2D: knowledge PostgreSQL CRUD and version history added to code; local migration tests, approved imports and contextual retrieval remain pending.
- Login profiles for Facebook/WhatsApp/Instagram are not automated yet; platform terms and official API permissions will be respected.
- Windows installation and runtime tests must be performed on the target PC before describing the system as operational.

## Safety

All services should bind to `127.0.0.1` only. The API token controls the local runtime; noVNC must have separate access restrictions once installed. Treat user-created knowledge and browser profiles as sensitive local files, ensure backups are encrypted, and preserve a manual emergency-stop capability.

## Human approvals and site review permissions

Migration 006 adds immutable, expiring review drafts; migration 007 adds per-site read-only permissions.
Use **Accounts** to register a domain and explicitly allow reading it. By default, review is denied.
The same domain must be in `browser-worker/.env` `BROWSER_AGENT_DOMAINS`; both checks apply.
Use **Approvals** to prepare and approve draft messages or posts, but approval only
records a decision and **does not send or publish content**. No external write tools exist.

Run tests before claiming the integration works:
```powershell
cd runtime
npm run typecheck
npm test
```
Set `TEST_DATABASE_URL` only for a disposable PostgreSQL test database to run SQL tests.
