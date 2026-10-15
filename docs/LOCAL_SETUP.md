# Personal AI Workspace — Windows local setup (Phase 2A)

This setup starts the **API and PostgreSQL-backed control state only**. It does **not** install a real agent, browser, noVNC, or AI model. A successful API health check does not mean those integrations are operational.

## Prerequisites

- Windows 10/11, PowerShell, Git, Node.js **22 or newer** (the runtime uses Node's `process.loadEnvFile`).
- PostgreSQL (16 or newer recommended), running locally.
- WSL2 is optional for Phase 2A; it will be useful later for the Chromium/noVNC container setup.
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
- Never commit `.env`, send your token in chat, or expose PostgreSQL to the internet.

Run database migrations and start the runtime:

```powershell
npm run migrate
npm run start
```

In a separate PowerShell window, check the public health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:4100/v1/health
```

Expected **only after successful local testing**: API and PostgreSQL report `up`; Ollama/Playwright/noVNC remain `unknown` in Phase 2A. Missing migration or database connectivity must be fixed before control can work.

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

## 6. What is still missing

- Phase 2B: verified local Ollama connection and chat execution.
- Phase 2C: Chromium/Playwright persistent profiles and noVNC live viewer.
- Phase 2D: persistent Knowledge Center and real browser tasks/approvals.
- Login profiles for Facebook/WhatsApp/Instagram are not automated yet; platform terms and official API permissions will be respected.
- Windows installation and runtime tests must be performed on the target PC before describing the system as operational.

## Safety

All services should bind to `127.0.0.1` only. The API token controls the local runtime; noVNC must have separate access restrictions once installed. Treat user-created knowledge and browser profiles as sensitive local files, ensure backups are encrypted, and preserve a manual emergency-stop capability.
