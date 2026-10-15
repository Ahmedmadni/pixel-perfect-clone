# Local API contracts (v1)

Base URL: `VITE_LOCAL_API_URL` (default `http://127.0.0.1:4100`). JSON only. Auth: `Authorization: Bearer <local token>`.
Types live in `src/lib/api/types.ts` and are the source of truth.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | /v1/health | — | `HealthResponse` |
| GET | /v1/agent/status | — | `AgentStatus` |
| POST | /v1/agent/control | `{ event: ControlEventType }` | `{ ok: true }` or 409 if transition invalid |
| GET | /v1/browser/tabs | — | `BrowserTab[]` |
| GET/POST | /v1/chat/messages | `{ content }` | `ChatMessage[]` / `ChatMessage` |
| GET | /v1/tasks | — | `AgentTask[]` |
| GET | /v1/accounts | — | `BrowserAccount[]` |
| GET | /v1/schedules | — | `ScheduledTask[]` |
| GET | /v1/approvals | — | `ApprovalRequest[]` |
| POST | /v1/approvals/:id | `{ decision: "approve" \| "reject" }` | `{ ok: true }` |
| GET | /v1/logs | — | `ActivityLog[]` |
| (Phase 2) CRUD | /v1/knowledge | `KnowledgeItem` | versioned items |

## Control state machine
States: `MANUAL, AGENT_ACTIVE, APPROVAL_REQUIRED, PAUSED, STOPPED, ERROR`.
Table in `src/lib/control-machine.ts` — the server must import/replicate it and reject invalid events with 409.
`EMERGENCY_STOP` and `FAIL` are valid from any state; `STOPPED`/`ERROR` leave only via `RESET`.

## Client error states
`ApiError.kind`: `offline` (unreachable), `timeout` (8s), `http` (non-2xx). UI shows each distinctly.
