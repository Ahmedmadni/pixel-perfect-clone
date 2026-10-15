# Local setup (Windows)

1. Install Node 20+, Git, PostgreSQL 16, Ollama (`ollama pull llama3.1:8b`).
2. Clone the GitHub repo synced from Lovable, then `npm install`.
3. Create `.env.local`:
   ```
   VITE_MOCK_MODE=false
   VITE_LOCAL_API_URL=http://127.0.0.1:4100
   VITE_NOVNC_URL=http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
   ```
4. Run the local runtime (Phase 2, separate `runtime/` package): Fastify on 127.0.0.1:4100, Playwright with
   visible Chromium + persistent profiles, a VNC server (e.g. TigerVNC) + websockify/noVNC on 6080.
5. `npm run dev` and open http://localhost:8080.

Security: bind every service to 127.0.0.1 only, require the local bearer token, keep agent browser
control disabled per account until granted, and write every control/approval event to the audit log.
Without step 3 the app stays in clearly labeled mock mode.
