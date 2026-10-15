# Phase 2C — local browser worker (development milestone)

This service runs a **real visible Chromium** on Xvfb, with Playwright attached to a persistent profile and noVNC showing the same desktop. The worker is intended to be reached **only by the local Fastify backend**, never directly from a hosted website.

## Local-only stack

- Playwright `1.64.0` (pinned to the matching official Microsoft Chromium Docker image).
- Xvfb and x11vnc (the x11vnc VNC password is required; starts globally view-only).
- noVNC/websockify served on host `127.0.0.1:6080`.
- Worker HTTP API available on host `127.0.0.1:4300`, requiring a separate strong bearer token.
- Persistent browser profile in Docker volume `paw_browser_profiles`.

The image is relatively large, but the tools are free. Container/runtime quality and browser compatibility **have not been validated on the user's Windows machine**. Chromium sandbox remains enabled: a compatible Linux user-namespace/seccomp configuration may be required. We do **not** silently disable it to make the browser start.

## Setup (later, on the user's machine)

1. Install Docker Desktop and enable WSL2 (subject to your license eligibility), or run Docker Engine in Linux.
2. Copy `browser-worker/.env.example` to `browser-worker/.env`.
3. Generate strong values for `BROWSER_WORKER_TOKEN` (at least 32 characters) and `VNC_PASSWORD` (8+ distinct characters). Keep them private; use **different** values.
4. Optionally specify approved agent-navigation domain names in `BROWSER_AGENT_DOMAINS`. Leave empty until agent permissions are configured.
5. From repository root: `docker compose -f compose.browser.yml up --build`.
6. noVNC: `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale`. It will request the VNC password.
7. No browser input is permitted until the authorized runtime issues a MANUAL handoff to the worker.

## Worker API — private backend-to-backend only

All requests require `Authorization: Bearer <BROWSER_WORKER_TOKEN>`. Requests with browser `Origin` headers are rejected.

| Method | Path | Data | Notes |
|---|---|---|---|
| GET | /health | — | true worker/browser readiness |
| GET | /tabs | — | actual Playwright pages |
| POST | /control | `{"state":"MANUAL"` or `"AGENT_ACTIVE"` etc.} | manages VNC input server-side |
| POST | /tabs/new | `{}` | MANUAL only |
| POST | /tabs/activate | `{"tabId":"..."}` | MANUAL only |
| POST | /tabs/navigate | `{"tabId":"...","url":"https://..."}` | MANUAL only |
| POST | /tabs/close | `{"tabId":"..."}` | MANUAL only |
| POST | /agent/inspect | `{"tabId":"..."}` | AGENT_ACTIVE read-only |
| POST | /agent/navigate | `{"tabId":"...","url":"https://..."}` | AGENT_ACTIVE, HTTPS + approved domain only |

At this milestone the worker **cannot post, reply, send messages, delete, or upload** to external websites. No account permissions are automatically granted. Page text from `/agent/inspect` is untrusted input, not AI instructions.

**Pending before production:** end-to-end browser tests on Windows, proof of safe runtime-to-worker handoff, durable per-account profiles with permission policies, hardened seccomp profile/browser isolation, failure recovery, HTTPS/auth access boundary to noVNC if remote access is ever introduced. Never publish ports to 0.0.0.0 or use the VNC session from Lovable's cloud preview.

## Unit tests

`cd browser-worker && npm test` runs built-in Node.js unit tests for policy (no browser required).
