# Personal AI Workspace — development status
Date: 2026-10-16

## Source of truth
- Repository: `Ahmedmadni/pixel-perfect-clone`, branch `main`.
- Lovable project: `d8eb5115-13ea-4fc2-9819-de495b7a7f34`.
- Lovable's internal latest edit SHA has differed from GitHub main in prior checks. **Confirm synchronization before a fresh Lovable edit.** Do not force push or rewrite history.

## Cloud verification (2026-10-16)

Public-repository GitHub Actions have now executed successfully for the
frontend, local runtime and actual disposable PostgreSQL. See verified run:
https://github.com/Ahmedmadni/pixel-perfect-clone/actions/runs/38869168507

- Frontend: 65/65 Vitest tests passed, strict TypeScript passed, production build passed.
- Runtime (without real Postgres): 43 tests passed, 4 real-DB tests skipped when no connection is configured.
- Real PostgreSQL 16 CI: 7/7 migrations applied, 47/47 runtime tests passed,
  including control audit, write-protected approvals, expiring decisions,
  read-only site permissions and task notifications.
- Browser policy: 3/3 lightweight Node tests passed.
- A separate **live Chromium/noVNC Docker smoke test** was added via
  `.github/workflows/browser-smoke.yml` and must be read separately; passing
  source tests does NOT prove Chromium/VNC is running.
- User-device Windows/WSL2/actual account sessions/Ollama inference have NOT been tested.

## Completed as source code, not as production verification

### Phase 1 — UI
Arabic RTL dashboard, clear mock-mode banner, navigation, demo pages, typed API layer, control-state reducer and tests.

### Phase 2A — runtime foundation
Fastify local API, PostgreSQL control/audit schema, bearer token and CORS, fail-closed transitions and logs. Previous Lovable report stated 65 frontend and 5 runtime tests passed **before** later changes; it did not run tests on Windows.

### Phase 2B — Ollama chat code
Native Ollama model discovery/streaming client, model picker, live text stream UI, stream cancellation, persistent chat migration 002, bounded context and tests. Real Ollama on Windows and tests of the current revisions are pending.

### Phase 2C — free embedded Chromium architecture
- `browser-worker/`: pinned free Playwright/Chromium worker with persistent profile, visible Xvfb desktop, x11vnc and noVNC.
- `compose.browser.yml`: Docker Compose publishes worker and noVNC ports only on host loopback.
- Separate worker bearer token and VNC password.
- Worker starts STOPPED/view-only. Manual tab commands are authenticated through the Fastify gateway and checked again by the worker.
- Fastify exposes real browser tab list/new/activate/navigate/close APIs when the worker is installed. Frontend uses them in real mode.
- Agent top-level navigation is restricted to explicitly allowlisted HTTPS domains, including redirects.
- **No autonomous agent loop exists yet.** Health deliberately distinguishes browser readiness from agent readiness; real agent takeover is disabled.

### Phase 2E — supervised read-only browser review code
- `004_agent_tasks.sql`: persistent read-only jobs, statuses, reports and execution steps.
- `runtime/src/read-only-agent.ts`: one-task-at-a-time, explicit user-selected tab and locally installed Ollama model.
- `POST /v1/tasks` starts a read-only review, GET lists/results, POST cancel requests cancellation.
- Browser worker permission is **opt-in only**: `BROWSER_ENABLE_READONLY_AGENT=true` plus explicit approved domains; inspection checks domain before reading.
- No clicking, posting, replies, account changes or message sending are supported.
- The UI provides objective/model selection, cancel, and persisted report display.
- Agent switches control back to manual when task completes. Fail-closed startup and handoff protections remain.
- Tests added, not independently executed; real Windows Docker/Ollama/PG verification pending.

### Phase 2E extension — immutable human approvals and domain review permissions
- `006_approval_queue.sql`: manual review drafts, one-hour expiry, SHA-256 digest, database-enforced immutable content and final decisions.
- Approving a draft is NOT dispatch authorization; no external message or posting tools are implemented.
- `007_review_permissions.sql`: every registered website starts without review access; database prohibits enabling external writes.
- Accounts UI registers websites and toggles read-only review permissions, independently of the browser worker's environment allowlist.
- Task runner checks per-domain permission before acquiring control and after inspection/redirects, before sharing page text with local Ollama.
- Changes to read permissions cancel ongoing agent review and are audit logged.
- Direct START_AGENT, APPROVE, and RESUME HTTP control events are always denied; only a supervised task may acquire AI browser control.
- Added `runtime/test/approvals.test.ts`, `runtime/test/approval-pg.test.ts`, `runtime/test/permissions.test.ts`, plus updated control and reviewer tests.
- This extension is source-code complete for review but **not yet tested on Windows or real PostgreSQL**.

### Phase 2F — local notification inbox foundation
- `005_notifications.sql`: local task status notices only, no copied page content.
- Task completion/failure/cancellation writes an event atomically with its status.
- Authenticated GET and mark-read endpoints, plus Reports UI inbox and refresh.
- External Telegram/WhatsApp notification adapters and periodic schedules remain future, opt-in tasks.
- New tests exist but have not run in this GitHub-only development session.

### Phase 2D — knowledge and reply styles code
- `003_knowledge.sql`: personal knowledge and full version-history tables.
- Local PostgreSQL CRUD, optimistic concurrency (expectedVersion), restore and hard delete with content-free audit messages.
- Real mode UI uses PostgreSQL; mock mode remains localStorage and never silently sends fake data.
- Ollama chat includes a bounded locally retrieved selection of instructions, styles and request-relevant records.
- No cloud database or paid vector service needed; full semantic memory, backup/import controls and device verification remain future work.

## Additional device/integration tests still required
- Browser policy: `browser-worker/test/policy.test.mjs`.
- Fastify bridge: `runtime/test/browser.test.ts`.
- PostgreSQL knowledge route contract: `runtime/test/knowledge.test.ts`.
- Ollama model/stream and local-memory unit tests under `runtime/test/`.
- Opt-in GitHub Actions: `.github/workflows/verify.yml` (manual workflow_dispatch, not automatic to conserve private-repository usage minutes).

**The repository now passes cloud tests, including a real PostgreSQL database.** This still does not certify the physical Windows runtime, real browser, VNC handoff or logged-in sessions. Browser Docker image, Linux user namespace/seccomp, actual noVNC mouse ownership and persistent login sessions must be tested locally before declaring operational readiness.

## Remaining milestones
1. Maintain passing public CI after every commit; investigate the independent Chromium/noVNC smoke result and fix failures.
2. Windows/WSL2 smoke test of PostgreSQL, Ollama, Docker browser worker, noVNC password and server-side VNC handoff.
3. Test approvals and deny-by-default domain policies end-to-end; only then design separate official, user-authorized adapters for any future external actions.
4. Phase 2F: durable task scheduling and optional free internal/Telegram status alerts with opt-in and no personal page content by default.
5. User-authorized import/export and encrypted backup of private knowledge and browser profiles.
6. Audit integrations with official Facebook Pages/Instagram Business/WhatsApp Business APIs before enabling messaging; do not rely on unauthorized personal-account automation.

## Zero-subscription principle
All proposed browser components (Chromium, Playwright, Xvfb, x11vnc, noVNC), Fastify, PostgreSQL and Ollama are free/open-source software, but local hardware resources, electricity, Docker Desktop license eligibility and GitHub/Lovable free-tier quotas remain relevant. No paid browser-hosting service is required.
