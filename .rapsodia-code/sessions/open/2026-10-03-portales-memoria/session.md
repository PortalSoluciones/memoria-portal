# Session: portales-memoria

Goal: Design a shared, always-online memory for the Portales team's coding agents (5 members) with
per-member attribution, and settle the architecture before implementation starts.

## Context

The team uses Engram locally (one SQLite brain per developer). Sharing it across five people would
mean hosting Engram Cloud — a Go container plus Postgres — and even then it is local-first
replication with push/pull lag, not one shared source of truth. The team wants a single online
memory that is immediately current for everyone and that nobody has to run.

Research into Gentleman-Programming/engram confirmed that Engram Cloud already uses Postgres
(`ENGRAM_DATABASE_URL`) but still needs a self-hosted Go runtime plus its own auth and dashboard.
The chosen path is Supabase (managed Postgres) with a thin serverless MCP layer, so no server the
team operates.

## Decisions

| # | Decision | Rationale | Alternatives |
|---|----------|-----------|--------------|
| D1 | Supabase (free tier) Postgres is the single shared source of truth | One copy of the truth: a write is visible to the next read by anyone, with no sync step; managed; free tier covers the workload | Engram Cloud (self-hosted Go + Postgres, replication lag); hosted SaaS memory Zep/mem0 (paid, data off-site, their model) |
| D2 | One Supabase Edge Function (Deno) exposes an MCP endpoint over Streamable HTTP | Serverless: nothing for the team to run; OpenCode supports remote MCP natively | Supabase's official MCP + raw SQL (unsafe, dev-only); a self-hosted MCP server |
| D3 | Per-member bearer token resolved to a `members` row | Smallest thing that gives identity; OpenCode's remote-MCP OAuth cannot use Supabase Auth as an authorization server | Supabase Auth (heavier; OAuth not MCP-compatible) |
| D4 | Author is taken from the token, never from a tool parameter | Prevents impersonation; enables "who knows what" and an author filter | Author as a parameter (spoofable) |
| D5 | `scope`: `shared` (default) vs `personal` | Shared team KB plus private per-member notes | shared-only (no private notes) |
| D6 | Projects are a text grouping, auto-created; the default comes from the member row (`portales`) and is overridable per call | No project CRUD ceremony; agent-agnostic (the default needs no per-harness config) | A `projects` table with create/list management |
| D7 | 7 tools: `mem_save`, `mem_search`, `mem_context`, `mem_get_observation`, `mem_session_summary`, `mem_list_projects`, `mem_whoami` | Most of Engram's 23 tools exist to reconcile local copies (sync, merge, doctor, session-local) that do not exist with one shared DB; each tool costs context tokens every session | Port all 23 tools |
| D8 | Postgres full-text search first; `pgvector` deferred | FTS is enough for text memories; add vectors only if recall falls short | `pgvector` now |
| D9 | New project dir `D:\proyect\PortalesCode\portales-memoria` | Isolates the memory system from the viewer project | A folder inside `visualizador-inmobiliario` |
| D10 | Agent-agnostic: standard MCP over Streamable HTTP with a bearer `Authorization` header, plus a tiny stdio bridge for harnesses limited to local MCP | Must work in any MCP harness (Claude Code, Codex, Gemini CLI, Cursor, …), not only OpenCode | OpenCode-only remote-MCP config (breaks other harnesses); remote-only with no stdio fallback |
| D11 | Deploy with the Supabase CLI (`link` + `db push` + `functions deploy`) | The user chose the CLI; credentials are in hand | Deploy from the dashboard |

## Tradeoffs

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Supabase free | $0, managed, quota is several times enough | Pauses after 7 days of inactivity | Chosen for now |
| Supabase Pro | Never pauses, 8 GB, backups | $25/mo | Fallback if the pause hurts |
| Per-member token | Simple identity, no OAuth to build | Manual distribution and rotation | Chosen |
| Supabase Auth | Real users, RLS | Not reachable by OpenCode remote-MCP OAuth | Deferred |
| 7 tools | Lean context, less surface | Fewer features on day 1 | Chosen |
| 23 tools | Feature parity with Engram | Context bloat; most solve non-problems here | Rejected |
| Remote-only MCP | One URL, simple | Harnesses that only speak local stdio MCP cannot connect | Rejected |
| MCP + stdio bridge | Works everywhere | One extra shim to publish | Chosen |

## Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Free-tier pause after 7 days of inactivity | Outage until resumed from the dashboard | Keep-warm daily ping (GitHub Actions) or move to Pro |
| RLS does not apply (the function uses the service role) | A bug could expose `personal` scope | Enforce visibility in function logic; one shared auth path; test with two tokens |
| Token leakage | Impersonation | Store only token hashes; rotate; one token per member |
| Edge Function limits (2s CPU, body caps) | Slow or failed writes | Indexed FTS queries; text-sized payloads are tiny |
| Harness header support varies | Some clients cannot send `Authorization` | Ship a stdio bridge that carries the token from env |

## Resolved Questions

- [x] Which Supabase org/project — project `vfjgwyiqlesbuudhulcf`; credentials in hand.
- [x] Deploy method — Supabase CLI; `supabase init` + `link vfjgwyiqlesbuudhulcf` done inside the project.
- [x] Default project name — `portales`.
- [x] Which agents — any MCP harness, not only OpenCode (agent-agnostic).
- [x] Free tier + keep-warm ping vs Pro — Free with a keep-warm ping; revisit Pro if it hurts.

## Open Questions

(none)

## Action Items

- [x] T1 — Supabase schema applied (migration `20261003000000_init.sql`).
- [x] T2 — Edge Function MCP: token auth plus the five core tools (deployed; review abandoned).
- [x] T3 — Team/project tools: `mem_list_projects`, `mem_whoami`, and the author filter.
- [ ] T4 — Client config (remote MCP + stdio bridge) plus per-member onboarding.
- [ ] T5 — End-to-end check with two tokens: save, search, attribute.
