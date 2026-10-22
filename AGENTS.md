<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Product contract — keep the interface simple
- The ONLY primary experience: user opens any HTTP(S) site in real Chromium, selects an existing tab, gives the assistant instructions FOR THAT SAME TAB. Keep navigation minimal: browser, actual task history, settings.
- Lovable hosted preview has **ZERO fake records** (no pretend browser tabs, accounts, successes, chat messages, seeded memory or localStorage demos). Always clearly indicate the runtime is disconnected; never simulate execution as success.
- Browser UI is driven by actual Fastify + private Chromium Playwright worker and local Ollama; the hosted Lovable preview cannot access the user's private localhost.
- Current agent tasks: bounded read/summarize, scroll, same-origin safe link navigation and non-submit text/search fields. Worker pins exact active HTTPS tab and origin at start; max four safe actions. No arbitrary buttons, submission, sending messages, publishing, purchasing, deleting, secrets or cross-domain automation.
- Do not trust Ollama's own claims as proof an action happened; report verified Playwright actions only. Workers enforce authorization, not UI/model prompts.
- Development source-of-truth is GitHub main. Never rebase/squash/force-push Lovable-linked history.
- Arabic RTL first, responsive mobile. Preserve setup for Windows and loopback-only secrets; do not disable Chromium sandbox for real accounts.
- Actual Windows + real Ollama inference remains unverified until run on the user's machine. Document limitations in `docs/CURRENT_STATUS.md` rather than showing dummy work.
- Ollama/chat HTTP endpoints belong to the separate loopback Fastify runtime, not hosted server functions; reserve each conversation before asynchronous preparation and release it only after stream persistence settles to prevent overlapping generation.
