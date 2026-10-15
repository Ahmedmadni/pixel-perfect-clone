# Personal AI Workspace — local HTTP API (Phase 2A)

**Current verified scope:** API foundation and SQL migrations are implemented in the repository. These do not make the AI model or browser operational. Local Windows testing is still required.

- Base URL: `http://127.0.0.1:4100` by default (set `VITE_LOCAL_API_URL` for the frontend).
- HTTP JSON responses. `GET /v1/health` is public; every other implemented route requires `Authorization: Bearer <RUNTIME_TOKEN>`.
- Only explicitly allowlisted local origins can make browser requests (`CORS_ORIGINS`).
- `VITE_MOCK_MODE=true` is the default: all frontend requests use clearly labeled mock data and do not hit the runtime.
- Runtime source: `runtime/src/app.ts`. API data types: `src/lib/api/types.ts`.

## Actually implemented in the runtime (Phase 2A)

| Method | Endpoint | Request | Success response | Failure |
|---|---|---|---|---|
| GET | `/v1/health` | — | `HealthResponse` with probed PostgreSQL; unprobed services `unknown` | foreign Origin: 403 |
| GET | `/v1/agent/status` | Authorization header | `AgentStatus` including authoritative `snapshot` | 401/403/503 |
| POST | `/v1/agent/control` | ControlEvent JSON with `type` (see below) | `{ "ok": true, "snapshot": ControlSnapshot }` | 400 bad payload; 409 invalid transition; 503 unavailable |
| GET | `/v1/logs?limit=100` | Authorization header; limit 1–500 | `ActivityLog[]` | 400/401/403/503 |

**IMPORTANT:** The event body uses the key **`type`**, not `event`. Examples:

```json
{"type":"START_AGENT"}
```

```json
{"type":"REQUEST_APPROVAL","reason":"Approval required before external message"}
```

```json
{"type":"FAIL","error":"Browser worker disconnected"}
```

`EMERGENCY_STOP` and `FAIL` are valid from `MANUAL`, `AGENT_ACTIVE`, `APPROVAL_REQUIRED`, and `PAUSED`. `STOPPED` and `ERROR` can only exit through `RESET`. The runtime shares the pure transition table in `src/lib/control-machine.ts`, performs row-locked transactional changes, and appends an audit log.

**Agent ownership is a control record, not proof of a running browser worker.** The frontend must not offer handoff to real agent control until services are explicitly verified and tested. Browser and model are **NOT implemented** in Phase 2A.

## Planned routes — not implemented yet (do not label as operational)

| Method | Endpoint | Intended use |
|---|---|---|
| GET | `/v1/browser/tabs` | Real browser tabs after Chromium/Playwright integration |
| GET/POST | `/v1/chat/messages` | Ollama-backed conversation, persisted history |
| GET | `/v1/tasks` | Agent queue |
| GET | `/v1/accounts` | Approved browser profiles and login states |
| GET | `/v1/schedules` | Background task scheduler |
| GET | `/v1/approvals` | Pending approval records |
| POST | `/v1/approvals/:id` | Approve/reject a specific queued action |
| GET/POST/PUT/DELETE | `/v1/knowledge` | Persistent versioned knowledge center |

The current frontend renders these sections in mock mode; in real mode, unsupported routes should show clear errors, not fallback sample data.

## Client handling & security

- Do not change real-mode control UI until the server confirms with a snapshot. Read `/v1/agent/status` at startup, after token change, and on reconnect.
- Invalid transition: HTTP 409. Database unavailable: HTTP 503 and **fail closed**.
- Browser host and API must bind exclusively to loopback. Never expose these services to a public domain.
- The settings page stores the bearer token **in tab/session-scoped sessionStorage**, not source files or persistent localStorage. It is still accessible to scripts on the same origin: prevent XSS, use a trusted local frontend only, and do not paste secrets into cloud previews.
- API token is not a noVNC credential. Before Phase 2C, protect the noVNC endpoint separately and ensure server-side manual/agent ownership enforcement; UI overlays alone are not a security boundary.
