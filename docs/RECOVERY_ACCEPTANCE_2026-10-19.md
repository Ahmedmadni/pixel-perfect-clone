# Service outage/recovery acceptance — 19 October 2026

## Scope
This milestone adds reproducible, isolated recovery coverage to `.github/workflows/browser-smoke.yml`. The scenario uses a disposable real Chromium/noVNC browser, Fastify, and PostgreSQL in GitHub Actions, plus a **fake Ollama HTTP fixture**. Nothing here proves that a real Ollama model or the owner's Windows installation has been exercised.

## Coverage matrix

| Failure mode | Test evidence | Success condition |
|---|---|---|
| Chromium worker stopped | Browser Worker Smoke Test, worker outage step | Worker API unreachable while stopped, then Chromium/noVNC ready, view-only and `STOPPED`; test cookie survives |
| Ollama fixture killed | Browser Worker Smoke Test, Ollama outage step | Fastify health changes Ollama from `up` to not-up and back |
| PostgreSQL test container stopped | Browser Worker Smoke Test, database outage step | Fastify health reports postgres unavailable, then up; browser remains `STOPPED` and view-only |
| Application state after DB recovery | Browser Worker Smoke Test, database outage step | Agent control is `MANUAL` or `STOPPED` (never active) and existing browser tabs are readable |
| Normal Windows local shutdown | `scripts/windows/stop.ps1` and static regression | Only named project containers are stopped; volumes are not deleted |
| Manual Chromium restart | `scripts/windows/restart-browser.ps1` and static regression | Refuses maintenance when worker is unreachable or not `STOPPED`; requires `STOPPED` on return |

### Important test boundary
GitHub's disposable Chromium worker uses the explicitly isolated offline CI browser configuration due to runner sandbox constraints. It must **not** be copied into normal Windows operation. Windows launch preflight blocks that mode. Browser persistent profiles, cookies and `.env` from actual accounts must never enter CI.

## Required owner-machine acceptance before production

1. Install and start supported Docker Desktop/WSL2 in **Linux containers mode**, Node 22+, Bun and Ollama.
2. Launch from the repository root with `.\scripts\windows\launch.ps1`. Do not paste locally generated secrets into chats or hosted Lovable.
3. Install a real Ollama model and run `.\scripts\windows\diagnose.ps1 -Strict -TestInference`; capture only redacted statuses, no secrets.
4. Manually test visible Chromium/noVNC, tab handoff, and an artificial session cookie with sandbox **enabled**.
5. Verify a deliberate browser restart from `STOPPED`, and a separate safe shutdown with `stop.ps1`; prove the dummy session survives.
6. Run encrypted database and browser-profile backup/verification/isolation restore tests. Do not use real account credentials during initial acceptance.
7. Confirm service listeners stay on loopback, Windows disk encryption is enabled as appropriate, and no external sending/publishing permissions have been enabled.

Record individual PASS/FAIL/BLOCKED results in [Windows acceptance protocol](WINDOWS_ACCEPTANCE_PROTOCOL.md). No green CI result can be substituted for those local results.

## Production blockers that remain
- No verified real Ollama model inference on owner's PC.
- No verified user-machine Chromium sandbox and noVNC handoff.
- No verified user-machine backups/profile restoration.
- No licensed/approved external posting or messaging adapter; approval queue is **not** an execution adapter.
- An untested or failed recovery check means **no production approval**, regardless of earlier passing workflow runs.

## Additional review — Chromium persistence regression

A later Browser Worker Smoke Test at commit `553b16f9dd026998761cf3af4e3f6a36dfcb8163` (run `39247827287`) **failed** specifically at the synthetic cookie persistence assertion after a container restart, despite the earlier run `39247761231` passing. This is an intermittent or environment-sensitive problem until root cause is established; do not mark persistence fully accepted. Follow-up commit `ea41be5c1434fd2539c208d40f859aabb5238aef` adds safe health-field diagnostics to failed CI runs without logging secrets or cookies. Its run must be reviewed separately. The recovery test remains strict; it does not turn an absent cookie into success.

**Release blocker:** prove consistent persistence in repeated isolated browser runs and then on the owner's sandbox-enabled Windows host before using real accounts.

## Graceful shutdown hardening — October 19, 2026 (later revision)

A follow-up isolated Browser Worker Smoke Test run `39267326070` passed after an earlier Chromium synthetic cookie persistence failure. Because both outcomes have occurred, the production persistence gate remains open. The latest changes increase Docker stop/restart grace periods to **30 seconds** in the offline CI workflow and both Windows maintenance scripts so Chromium has more time to close its persistent context and flush its database-backed cookie store. The static safety regression assertions were updated accordingly. These changes do **not** claim that 30 seconds guarantees durability; acceptance requires green CI and the owner's sandbox-enabled Windows test with a dummy profile.

## Windows view-only restart hardening — 20 October 2026

The local `restart-browser.ps1` maintenance command now verifies **both** `mode=STOPPED` and `viewOnly=true` (as well as browser/noVNC readiness) **before** stopping Chromium and **after** it comes back. A running manual or agent-controlled browser must not be silently restarted. Static security regressions enforce these guards.

The prior `Verify Cloud Development` workflow failures after graceful-stop changes were traced to an outdated expected command pattern in `browser-production-config.test.mjs` for PostgreSQL `stop -t 30 database`. The assertion was corrected without relaxing the prohibition on volume deletion, pruning, or sandbox bypass.

These changes remain subject to GitHub CI on the new commits and Windows-machine verification. A green static check alone does not prove real profile durability on the owner's machine.

## Maintenance lock protocol — 20 October 2026

Chromium now exposes an authenticated backend-only `POST /maintenance/lock`. It acquires a **process-local one-way maintenance lock only while STOPPED**, reapplies view-only mode, and rejects subsequent transitions to MANUAL or AGENT_ACTIVE until the worker process restarts. A Windows maintenance restart calls this endpoint before stopping the named worker container and refuses success unless the lock and view-only state are confirmed. There is deliberately no remote unlock endpoint. No user sessions or personal settings are sent to CI. This closes the handoff race inside the worker process; it cannot protect against unrelated host processes or a different worker instance. The feature still requires fresh CI and owner-machine acceptance.
