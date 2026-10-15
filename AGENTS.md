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

## Architecture rules
- Frontend only talks to the local runtime via `src/lib/api/client.ts`; contracts in `src/lib/api/types.ts` + `docs/API.md` — keeps frontend and runtime separable.
- Mock mode is default and must always be visibly labeled; never present mock data as a real integration.
- Agent control states only change through `src/lib/control-machine.ts` (pure, tested) — server reuses the same table.
- No cloud database by default; Phase 1 knowledge is stored in localStorage until `/v1/knowledge` exists.
- UI is Arabic-first RTL; use logical spacing (ms/me/ps/pe/start/end), never left/right.
