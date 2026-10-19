# Windows acceptance protocol — Personal AI Workspace

**Baseline:** `main` at handover commit `e71ebcdbbf24aa6e025bc7b47f303f975a38461b` (2026-10-19).  
**Status:** **NOT EXECUTED on owner's Windows PC**. This is an operator-run acceptance checklist, not evidence of a passed test.

## Ground rules

- Start with a **fresh test-only browser profile** and artificial data, not real accounts.
- Keep Chromium sandbox **enabled**. Do not set `BROWSER_CI_TRUSTED_SMOKE=true`, use `--no-sandbox`, or weaken container security to bypass errors.
- Agent automation and external writes stay **OFF** by default. No posting, sending, submitting forms, payments or deletion.
- Never upload `.env`, API tokens, cookies, browser profiles, .pawbak, passwords, personally identifying screenshots or unredacted logs to GitHub/Lovable/chat.
- Do **not** run `docker compose down -v`; that may erase persistent data.
- Mark each gate PASS/FAIL/BLOCKED only after observing evidence on the Windows computer. A CI success cannot turn any gate below into PASS.

## Gate W0 — Host prerequisites and safe setup

1. Confirm Windows has Docker Desktop + WSL2 (Linux containers), PowerShell 5.1+, Node.js 22+, npm, Bun and Ollama. Start Docker and Ollama.
2. In the repository root, on the **first** launch only: ` .\scripts\windows\launch.ps1 ` (remove surrounding spaces when pasting). Existing settings must not be overwritten.
3. For troubleshooting, run `.\scripts\windows\preflight.ps1` before launching services, without publishing its private configuration.
4. Confirm Chromium is using its production sandbox; **do not** override browser restrictions if it fails.

**PASS if:** tools are present, preflight succeeds, launcher completes, the local-only UI opens at `http://127.0.0.1:8080`, and sandbox has not been disabled.

## Gate W1 — Actual local inference and service readiness

1. Install an Ollama model appropriate to the host hardware, e.g. `ollama pull llama3.2`. This downloads a model; it is not part of cloud CI.
2. Run `.\scripts\windows\diagnose.ps1 -Strict -TestInference`.
3. Confirm PostgreSQL, Fastify, worker/Chromium, noVNC, Ollama and **actual inference** show ready. The script intentionally does not print the model answer.
4. Temporarily stop Ollama **after** noting the successful result, rerun diagnostics and verify that strict mode fails closed; restart Ollama and rerun successfully.

**PASS if:** a real local model generates a response, all mandatory services report ready, and unavailable inference causes a failed strict check.

## Gate W2 — Manual browser and session persistence

1. From the local UI, unlock the noVNC display using its **local-only** password (if requested).
2. Open two harmless public test pages in separate tabs, switch tabs, scroll and enter innocuous test text manually.
3. Confirm the active tab shown in the UI matches what the visible Chromium session shows.
4. Set a harmless test-only browser preference or cookie on an authorized test site.
5. Stop **only** the browser container using `docker compose -f compose.browser.yml stop browser-worker`; start it again with the project's normal launch/start script.
6. Confirm the profile state persists and the automation state is not silently resumed.

**PASS if:** manual control and tab synchronization work, test-only state persists, and the agent starts in a safe non-active state after restart.

## Gate W3 — Restrained agent and emergency stop

1. Use a **public HTTPS test page that you own or are expressly authorized to automate**. Enable only the specific read-only agent settings/permissions required for this test.
2. Request a harmless page read or scroll **in the currently active tab**. Check the recorded step and observed page state; do not trust the model's natural-language claims alone.
3. Attempt an out-of-origin navigation, tab switch during the task, and a request to submit/post. These must be blocked by policy; never use a real logged-in account for negative testing.
4. Pause/stop an in-progress harmless operation. Confirm control returns to the user without continuing a pending action.
5. Remove the test site's permission and verify a new task is denied.

**PASS if:** only allowed, logged steps execute; unauthorized actions fail closed; manual stop and permission revocation take effect. **Caution:** even a text-field fill can auto-save on some sites; avoid sensitive or state-changing fields.

## Gate W4 — Encrypted backup and isolated restore

1. With **artificial database records**, run `.\scripts\windows\backup.ps1` and keep the passphrase in a trusted local manager.
2. Run `.\scripts\windows\restore.ps1 -InputPath "<your-test-backup.pawbak>" -VerifyOnly`.
3. Perform the documented restore into a **new database only** and verify the original database remains intact. Do not paste paths containing private identifiers into reports.
4. Stop the browser worker, create a separate encrypted profile backup with `.\scripts\windows\browser-profile.ps1 -Backup`, verify it, then test restoration into a **new disconnected Docker volume** according to `docs/CHROMIUM_PROFILE_BACKUPS.md`.
5. Confirm the restore never overwrites an existing live browser profile.

**PASS if:** both archives pass integrity checks; DB and browser profile recover into separate targets without destructive replacement.

## Gate W5 — Real-world release decision

- Audit firewall/listening interfaces: API, PostgreSQL, browser worker, VNC and noVNC must not be exposed beyond loopback.
- Check disk space, local encryption/BitLocker, idle memory/CPU and model responsiveness on this machine.
- Verify no `.env`, secrets or test cookies have been committed or posted.
- Re-run `.\scripts\windows\diagnose.ps1 -Strict -TestInference`.
- Review W0–W4 results and all failures; **do not authorize production accounts** while any gate is failed or untested.

## Acceptance record (fill in locally; share only redacted results)

| Gate | Result (PASS/FAIL/BLOCKED/NOT TESTED) | Date | Redacted evidence or blocker |
|---|---|---|---|
| W0 — Host and sandbox | NOT TESTED | — | — |
| W1 — Services and real model | NOT TESTED | — | — |
| W2 — Manual tabs and persistence | NOT TESTED | — | — |
| W3 — Permissions and emergency stop | NOT TESTED | — | — |
| W4 — Backups and isolated restore | NOT TESTED | — | — |
| W5 — Local security/release check | NOT TESTED | — | — |

**Release rule:** All six gates must be witnessed as PASS and security concerns resolved before a separate production approval. Even a PASS does not add missing official WhatsApp/social/email sending integrations.

See [Windows Quickstart](WINDOWS_QUICKSTART.md), [Final Handover](FINAL_HANDOVER_2026-10-19.md), [Current Status](CURRENT_STATUS.md), [Database Backup](BACKUP_AND_RESTORE.md), and [Browser Profile Backups](CHROMIUM_PROFILE_BACKUPS.md).
