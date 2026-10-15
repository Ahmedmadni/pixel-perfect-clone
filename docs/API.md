# Personal AI Workspace — local HTTP API (Phase 2A + Phase 2B code)

**Current scope:** Fastify control API and Ollama chat integration are implemented in code. Actual Ollama/Windows connection and comprehensive Phase 2B verification are still pending. Chromium/noVNC is NOT implemented.

- Base URL: `http://127.0.0.1:4100` by default (set `VITE_LOCAL_API_URL` for the frontend).
- HTTP JSON responses. `GET /v1/health` is public; every other implemented route requires `Authorization: Bearer <RUNTIME_TOKEN>`.
- Only explicitly allowlisted local origins can make browser requests (`CORS_ORIGINS`).
- `VITE_MOCK_MODE=true` is the default: all frontend requests use clearly labeled mock data and do not hit the runtime.
- Runtime source: `runtime/src/app.ts`. API data types: `src/lib/api/types.ts`.

## Implemented routes (Phase 2A + 2B, pending integration validation)

| Method | Endpoint | Request | Success response | Failure |
|---|---|---|---|---|
| GET | `/v1/health` | — | `HealthResponse` with probed PostgreSQL; unprobed services `unknown` | foreign Origin: 403 |
| GET | `/v1/agent/status` | Authorization header | `AgentStatus` including authoritative `snapshot` | 401/403/503 |
| POST | `/v1/agent/control` | ControlEvent JSON with `type` (see below) | `{ "ok": true, "snapshot": ControlSnapshot }` | 400 bad payload; 409 invalid transition; 503 unavailable |
| GET | `/v1/logs?limit=100` | Authorization header; limit 1–500 | `ActivityLog[]` | 400/401/403/503 |
| GET | `/v1/models` | Authorization header | `{models: [{name, size, family, ...}]}` from Ollama `/api/tags` | 503 offline |
| GET | `/v1/chat/messages?conversationId=default&limit=50` | Authorization header; optional cursor `before` | `{messages: ChatMessage[], nextBefore}` oldest-to-newest page | 400/401/503 |
| POST | `/v1/chat/stream` | `{content,model,conversationId:"default"}` | `application/x-ndjson` incremental events | 400/409/503; stream `error` event |

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

`EMERGENCY_STOP` and `FAIL` are valid from `MANUAL`, `AGENT_ACTIVE`, `APPROVAL_REQUIRED`, and `PAUSED`. `STOPPED` and `ERROR` can only exit through `RESET`. The runtime shares the pure transition table in `src/lib/control-machine.ts`, performs row-locked transactional changes, and appends an audit log. **Until Phase 2C installs a verified browser worker, `START_AGENT`, `APPROVE`, and `RESUME` return HTTP 503 `browser_agent_not_ready` and cannot mark the agent active.**

**Agent ownership is a control record, not proof of a running browser worker.** The frontend must not offer handoff to real agent control until browser services are verified. Phase 2B adds local Ollama chat code but not browser control.

## Streaming protocol (Phase 2B)

POST /v1/chat/stream uses a validated *installed* model and streams newline-delimited JSON events:

```json
{"type":"user","message":{"id":"...","role":"user","content":"Hello","at":"..."}}
{"type":"assistant_start","message":{"id":"...","role":"assistant","content":"","status":"streaming","at":"..."}}
{"type":"delta","text":"مرحبا"}
{"type":"done","message":{"id":"...","role":"assistant","content":"مرحبا","status":"complete","at":"..."}}
```

On error it emits `{"type":"error","error":"..."}` when the connection remains writable and records the failed/aborted assistant row. Aborting the client's fetch aborts the upstream Ollama generation. Chat messages are stored in the local `chat_messages` PostgreSQL table (migration 002). Chat history in real mode no longer uses mock responses.

## Phase 2C browser integration — code present, local verification pending

Fastify never exposes the browser worker secret to the browser UI. If
`BROWSER_WORKER_TOKEN` is unset, these routes return 503 rather than simulated tabs.

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/v1/browser/tabs` | — | Real Chromium tabs (ID, title, URL, active status) |
| POST | `/v1/browser/tabs` | `{"action":"new"}` | Newly opened tab ID |
| POST | `/v1/browser/tabs` | `{"action":"activate","tabId":"UUID"}` | Activated tab ID |
| POST | `/v1/browser/tabs` | `{"action":"close","tabId":"UUID"}` | `{"closed":true}` |
| POST | `/v1/browser/tabs` | `{"action":"navigate","tabId":"UUID","url":"https://..."}` | Destination URL and tab ID |

All POST tab operations require confirmed `MANUAL` control in PostgreSQL and worker-side manual ownership. VNC input is controlled by the x11vnc server itself through worker transitions, not just hidden buttons. The local worker uses a distinct strong token, separate from Fastify's frontend token. noVNC also requires a separate password. Both worker/noVNC ports are bound to `127.0.0.1` on the host.

**AUTONOMOUS AGENT NOT YET IMPLEMENTED:** Health distinguishes working `playwright`/`novnc` from the future `agent`, which remains `unknown`. START_AGENT/APPROVE/RESUME are blocked until agentRunnerReady is explicitly verified. Browser inspection/navigate worker primitives are not a functioning AI planner. No posting or message sending is implemented.

## Planned routes — not implemented yet (do not label as operational)

| Method | Endpoint | Intended use |
|---|---|---|
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
