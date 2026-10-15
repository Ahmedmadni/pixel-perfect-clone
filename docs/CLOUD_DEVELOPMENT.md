# Workflow: Lovable + GitHub first, Windows later

## Where development happens

The project is authored in **Lovable** and stored in the private GitHub repository `Ahmedmadni/pixel-perfect-clone` (`main`). GitHub is the durable source for code reviews, changes and version history.

There are **two distinct environments**:

1. **Cloud development:** Lovable UI previews, GitHub source, GitHub-hosted compile/unit checks. This does not require the owner to install anything on a PC.
2. **Local execution (later):** Fastify, PostgreSQL, Ollama, visible Chromium/Playwright/noVNC run on the owner's Windows PC (or WSL2/Docker). A cloud preview cannot prove these services are running on the owner's device.

## Rules for ongoing cloud development

- Continue committing code directly to `main` or use feature branches/PRs if a change needs review.
- **Never force-push, rebase published Lovable commits or reset the project.**
- Keep `VITE_MOCK_MODE=true` in cloud preview unless a deliberately secured local bridge exists. Never submit a local API bearer token to cloud-hosted Lovable previews.
- Do not claim any implementation is operational on Windows until locally validated. Unit tests of fake Ollama, the state machine or Fastify injection cover program behavior only.
- Do not use paid browser-hosting services. Chromium, Playwright, noVNC and Ollama remain the intended free local stack.
- Future cloud code commits may require syncing GitHub with Lovable. If Lovable's internal commit SHA differs from GitHub main, verify sync in both systems before prompting Lovable to rewrite the same files.

## Optional cloud tests without local installation

GitHub Actions includes `.github/workflows/verify.yml`: **manual dispatch only**, to avoid automatically using private-repository build minutes on every commit.

It checks:
- Bun frontend tests, TypeScript and production build.
- Runtime Node 22/npm dependency installation, type checking and Vitest mock-based tests.

It **does not** certify PostgreSQL, Ollama, Chromium, a VNC server, WhatsApp, Facebook or Instagram running on the user's own PC. GitHub Actions quotas and charges, if any, are governed by the repository owner's GitHub plan/settings.

## Next implementation milestones

- **2B:** check GitHub-side Ollama integration, fix type/build/API/streaming issues, run cloud validation, then mark Windows integration pending.
- **2C:** Browser worker + Docker Compose + Fastify bridge + tab UI exist in source. Windows tests, sandbox validation and VNC handoff verification remain pending. Autonomous agent mode stays disabled until runner implementation.
- **2D:** PostgreSQL knowledge tables, versioned CRUD and real-mode UI added; production migrations and opt-in legacy data import remain pending.
- **2E:** agent task queue, approved tools, and confirmation before external effects.
- **2F:** verified reporting and notification adapters for authorized platforms.

The first local Windows setup should occur only when a milestone needs actual user-device integration testing, not for everyday code development.
