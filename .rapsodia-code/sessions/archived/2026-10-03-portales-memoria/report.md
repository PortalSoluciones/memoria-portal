# Session report: portales-memoria

## Executive summary

Designed and implemented a shared, always-online memory for the Portales team's coding agents: one
Supabase Postgres source of truth exposed as a stateless MCP Edge Function, with per-member
attribution and a 3-level hierarchy organization → area → project. No server the team operates.
All tasks (T1–T6) implemented, deployed and verified; the project is published at
https://github.com/PortalSoluciones/memoria-portal.

## Decisions (flattened)

- **D1** Supabase Postgres is the single shared source of truth (no sync, no lag).
- **D2** One serverless Edge Function exposes standard MCP over Streamable HTTP.
- **D3** Per-member bearer token resolved to a `members` row.
- **D4** The author is taken from the token, never a tool parameter.
- **D5** `scope`: `shared` (default) vs `personal`.
- **D6 / D12** 3-level hierarchy **organization → area → project**; search defaults to the whole
  organization and `area`/`project` narrow it.
- **D7** A small tool set (8), not Engram's 23.
- **D8** Postgres full-text search first; `pgvector` deferred.
- **D9** Project directory `portales-memoria`.
- **D10** Agent-agnostic MCP; a stdio bridge is the fallback for local-only harnesses (deferred).
- **D11** Deploy with the Supabase CLI.
- Free tier with a keep-warm ping; revisit Pro if it hurts.

## Risks / tradeoffs

| Risk | Mitigation |
|------|-----------|
| Free-tier pause after 7 days of inactivity | Keep-warm ping or daily use; Pro removes it |
| RLS does not apply (service role) | Visibility enforced in function logic |
| Token leakage | Store only hashes; rotate per member |
| No automatic backups on free | Accept, or move to Pro |

## ODD readiness

The ODD task doc `odd/tasks/portales-memoria.md` is complete (T1–T6). No further ODD handoff is
needed; this session closes without a handoff.

## Next steps

- Keep-warm ping (or daily use) so the free project does not pause.
- Optional **T7**: a per-workspace default `area`/`project` so agents do not pass them by hand.
- Optional: a **memory skill** so agents know when and how to use the tools (save by area/project).
- Members configure the MCP with their (rotated) token.
