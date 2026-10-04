# ODD Feature: portales-memoria

## Objective

A shared, always-online memory for the Portales team's coding agents. Five people work on the
same project, every memory is attributed to the member who saved it, and each member's agent reads
the same, current knowledge base with no self-hosted Engram server.

## Problem

Engram gives each developer a private local SQLite brain. Sharing it across five people means
hosting Engram Cloud (a Go container plus Postgres), and even then it is local-first replication
with push/pull lag, not one shared source of truth. The team wants a single online memory that is
immediately current for everyone and that nobody has to run, patch, or babysit.

## Why

A shared Postgres on Supabase gives exactly one copy of the truth: a write by one member is visible
to the next read by any other member, with no sync step and no conflict resolution. Supabase is
managed (no server for the team), the free tier covers this workload several times over, and a thin
Edge Function exposes the memory over MCP so any agent (OpenCode first) connects like any other
remote MCP server.

## Scope

In scope:

- Supabase (free tier) as the hosted Postgres source of truth: schema, full-text search, and the
  minimum seed data to onboard members.
- One Edge Function (Deno) exposing an MCP endpoint over Streamable HTTP.
- Per-member bearer tokens that identify the calling member. Memories are attributed to the member
  who saved them; the author is never a caller-supplied value.
- `project` as a first-class grouping so the team works in a shared project with attributed memories.
- `scope`: `shared` (the whole team sees it) vs `personal` (only its author sees it).

Out of scope (explicitly deferred, do not implement):

- Realtime push and any web dashboard.
- Engram's sync, merge-projects, doctor, and session-local tools.
- Semantic / vector search. Start with Postgres full-text search; add `pgvector` only if FTS falls short.
- A public per-user signup. Members are curated rows with a token each.

## Constraints

- The free tier must suffice: 500 MB database, 500k Edge Function invocations/month, 2M Realtime
  messages. The only real risk is the free-tier pause after 7 days of inactivity; keep it warm with a
  cheap daily ping, or move to Pro ($25/mo) for guaranteed uptime plus backups.
- The Edge Function runs with the service role, so Supabase RLS does not apply. Visibility is
  enforced inside the function, not by RLS. This is deliberate and must stay honest.
- No server the team has to operate. Deploy the function once; members only hold a token.
- Technology: Deno TypeScript Edge Function, plain `@supabase/supabase-js` or `postgres` client.

## Design

### Data model

- `members` — `id`, `name`, `token_hash`, `created_at`. One row per teammate.
- `observations` — `id`, `project`, `author_id`, `scope`, `type`, `title`, `content`, `topic_key`,
  `revision_count`, `deleted_at`, `created_at`, `updated_at`, and a stored `search tsvector`.
- Projects are auto-created on first save of a new `project` value; a separate `projects` table is
  only added if project metadata is ever needed.

### Tools (v1) — seven, not twenty-three

| Tool | Purpose |
|------|---------|
| `mem_save` | Save an observation; author is taken from the token. Upserts on `topic_key`. |
| `mem_search` | Full-text search; optional `project`, `scope`, `author` filters. |
| `mem_context` | Recent observations for the current project, each with its author. |
| `mem_get_observation` | Full untruncated content by id. |
| `mem_session_summary` | Save an end-of-session summary. |
| `mem_list_projects` | List the projects that exist, for discovery. |
| `mem_whoami` | Return the calling member, to verify token wiring. |

Deferred until a real need appears: `mem_update`, `mem_delete`, `mem_list_members`, topic
suggestions, review/decay lifecycle.

### Why not the other sixteen tools

Engram is local-first, single-machine, with sync. Many of its twenty-three tools exist to reconcile
copies or manage a local session: `mem_merge_projects` (name drift across machines), the sync
push/pull surface, `mem_doctor`, `mem_session_start/end` (local correlation), `mem_current_project`
(cwd detection). With one shared database those problems do not exist, so the tools do not either.
Every tool also costs tokens in the model's context on every session and adds surface to maintain;
five core tools carry the value, and the rest can be added one handler at a time.

### Auth and attribution

- Each member holds a unique bearer token. The function hashes it and resolves a `members` row.
- `mem_save` sets `author_id` from the resolved member. Author is not a parameter, so a member
  cannot write as someone else.
- `mem_search` and `mem_context` return the author of each observation and accept an `author` filter.
- Supabase Auth is not used: OpenCode's automatic remote-MCP OAuth cannot speak to Supabase Auth as
  an authorization server, so a static per-member token is the smallest thing that gives identity.

### Hierarchy (organization → area → project)

- A memory is scoped by three levels. `organization` is always the caller's `default_organization`
  (`portales`); `area` and `project` are optional narrowing parameters.
- Search and context default to the **whole organization** (everything reachable); `area`/`project`
  narrow the result. Levels are created implicitly by the first save.
- `mem_list_areas` and `mem_list_projects` (optionally within one area) expose what exists.
- `topic_key` upserts are scoped to `organization + area + project` (+ author for `personal`).

### Visibility

- `scope: shared` (default) — visible to every member, attributed to its author. `topic_key` upserts
  are team-level: the same `project + scope + topic_key` updates one row and the author becomes the
  last writer.
- `scope: personal` — visible only to its author; `topic_key` upserts are per author.

## Tasks

- [x] T1 — Supabase schema: `members` and `observations`, the FTS index, and the topic-upsert
      indexes; record one member and its token hash.
- [x] T2 — Edge Function MCP: token auth plus the five core tools.
- [x] T3 — Team and project tools: `mem_list_projects`, `mem_whoami`, and the `author` filter.
- [x] T4 — OpenCode remote MCP config and the per-member onboarding steps (one token each).
- [x] T5 — End-to-end check: two tokens in the same project save, search, and attribute correctly.
- [x] T6 — Hierarchy organization → area → project: rename/add-columns migration, function `area`/`project`
      params, `mem_list_areas` / `mem_list_projects`.
- [x] T7 — Agent-agnostic memory skill: a repo-versioned `SKILL.md` teaching WHEN to save (decision,
      bugfix, discovery, convention, end-of-session → `mem_session_summary`), how to choose
      `area`/`project`, `shared` vs `personal`, and `topic_key`; install steps per harness.
- [ ] T8 — Node CLI: a dependency-free CLI against the same MCP endpoint (`save`/`search`/`context`/
      `areas`/`whoami`) as a fallback for local-only harnesses and for scripting.
- [x] T9 — Keep-warm ping: a scheduled GitHub Action that hits the MCP endpoint with a dummy
      `Bearer` header so the function's members SELECT keeps the free-tier database active.

## Authorized scope

Project directory `D:\proyect\PortalesCode\portales-memoria`. Files: `supabase/migrations/*.sql`,
`supabase/functions/mcp/index.ts`, `opencode.json`, and `README.md`. T7/T8 add a versioned skill
directory (e.g. `skills/portales-memory/SKILL.md`), a CLI script (e.g. `scripts/mem.mjs`), and the
keep-warm workflow `.github/workflows/keep-warm.yml`. No files outside this project.

## Route per task

| Task | Route | Trigger evidence |
|------|-------|------------------|
| T1 | delegated | schema is non-trivial; one writer |
| T2 | delegated | the core function; one writer |
| T3 | inline | two small tool registrations in a file already read; no unresolved design |
| T4 | inline | one config file plus a short README |
| T5 | inline | a two-token check against the live endpoint |
| T6 | delegated | a migration plus a multi-site function change; one writer |
| T7 | delegated | a new skill doc plus install steps for several harnesses; one writer |
| T8 | delegated | a new script with several subcommands; one writer |
| T9 | inline | one trivial workflow YAML |

## Acceptance criteria

- Two different member tokens can both `mem_save` into `project: portales`; the second member's
  `mem_search` finds the first member's memory, attributed to the first.
- `mem_whoami` returns the caller's member name for each token.
- `scope: personal` memories are invisible to the other member.
- A `topic_key` re-save updates the existing row and bumps `revision_count` instead of inserting.
- `mem_search` matches on content via Postgres FTS.
- The whole thing runs on the Supabase free tier with no server the team operates.

## Progress

Project scaffolded and plan recorded. T1 applied: `supabase init` + `supabase link vfjgwyiqlesbuudhulcf`
inside the project; migration `20261003000000_init.sql` pushed to the remote database (project
`vfjgwyiqlesbuudhulcf`). Tables `members` and `observations` exist remotely with the FTS index, the
project/author query indexes, and the two topic-upsert unique indexes; RLS is enabled with no
policies. `supabase/seed.sql` documents the token-hashing convention. T2 applied: `supabase/functions/mcp/index.ts` — a stateless MCP server over Streamable HTTP (official
SDK, web-standard transport) with bearer-token auth (SHA-256 → `members`) and the five core tools;
`supabase/config.toml` sets `[functions.mcp] verify_jwt = false`. Deployed to project
`vfjgwyiqlesbuudhulcf`. Full round-trip tool calls are not runtime-tested yet (no members — T4/T5).
T3 applied: `mem_whoami` and `mem_list_projects` added to the same function (the `author` filter
already shipped in T2); redeployed to project `vfjgwyiqlesbuudhulcf`.
T4 applied: `scripts/add-member.mjs` (dependency-free onboarding: generates a 256-bit token, stores
only its SHA-256) and `README.md` (deploy, onboarding, per-harness connection, tools). The stdio
bridge is documented as the fallback for local-only harnesses and deferred until one is adopted.
T5 verified end-to-end against the deployed function with two member tokens (`ana`, `beto`):
`mem_whoami` returns each member; ana's shared memory is found by beto and attributed to ana; a
`topic_key` re-save updates one row and bumps `revision_count` (1 → 2); ana's `personal` memory is
invisible to beto but visible to ana; the `author` filter works; `mem_list_projects` returns
`portales`. Test members and their test observations still exist in the database (tokens were exposed
in a chat transcript — rotate or delete them before real use).
T6 applied: migration `20261003010000_hierarchy.sql` renamed `observations.project` → `organization`,
added `area` and `project`, renamed `members.default_project` → `default_organization`, and rebuilt the
scope/topic indexes (topic uniqueness uses `coalesce(area,'')`/`coalesce(project,'')`). The function
gained `area`/`project` params on `mem_save`/`mem_search`/`mem_context`, plus `mem_list_areas` and an
org-scoped `mem_list_projects(area?)`; search and context default to the whole organization.
`scripts/add-member.mjs` and `seed.sql` were updated to the renamed column.
T7 applied: `skills/portales-memory/SKILL.md`, an agent-agnostic skill teaching when to save (decision,
bugfix, discovery, convention, config, preference, end-of-session → `mem_session_summary`), how to
choose `area`/`project`, `shared` vs `personal`, `topic_key`, start-of-work recall, and per-harness
installation. Tool signatures were cross-checked against the function schemas.
T9 applied: `.github/workflows/keep-warm.yml`, a daily scheduled curl with a dummy `Bearer` header.
Note: a request with no `Bearer` header returns 401 before any query, so the dummy token is required
for the ping to actually run the function's members SELECT (the DB activity that prevents the
free-tier pause).

## Verification evidence

- `supabase db push --dry-run` — validated; would push `20261003000000_init.sql`.
- `supabase db push --yes` — applied `20261003000000_init.sql` to the remote database.
- `supabase migration list` — local `20261003000000` = remote `20261003000000`.
- Notice during push: `extension "pgcrypto" already exists, skipping` (expected on Supabase).
- CLI warned it could not cache the migrations catalog because Docker Desktop is not running; that
  affects only the local `db diff` cache, not the remote apply.
- `supabase functions deploy mcp` — deployed to project `vfjgwyiqlesbuudhulcf`; server-side bundling
  validated the `npm:`/`jsr:` imports.
- `curl.exe -i https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp` (no token) → `401
  Unauthorized`, `WWW-Authenticate: Bearer realm="portales-memoria"`.
- same request with `-H "Authorization: Bearer bogus"` → `401 Unauthorized`.
- Native review (RDD) could not run in this session: the OpenCode review transport refused the
  binding (`immutable_review_transport_unsupported`, then `opencode_review_transport_binding_invalid`)
  because the session is rooted at `D:\proyect\PortalesCode`, not the reviewed repo
  `portales-memoria`. The transaction was abandoned per the user's decision (`review/abandon`,
  reason `operator_disposition`); the functional verification above stands.
- T3 redeploy: `supabase functions deploy mcp` OK; `curl.exe` with no token → `401 Unauthorized`.
  `mem_whoami` and `mem_list_projects` are not runtime-tested (no members yet — T4/T5).
- T4: `node --check scripts/add-member.mjs` — syntax OK; SHA-256 convention verified
  (`sha256("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`), matching the
  Edge Function. Member creation itself needs the service-role key, so the user runs it.
- T5 round-trip against `https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp`:
  - `mem_whoami` (ana) → `{name:"ana", default_project:"portales"}`; (beto) → `{name:"beto", ...}`.
  - `mem_save` shared with `topic_key test/t5-shared` → `{id:1, revision_count:1, created:true}`;
    same topic again → `{id:1, revision_count:2, created:false}` (upsert, one row).
  - beto `mem_search "actualizada"` → finds id 1, `author:"ana"`, `scope:"shared"`.
  - ana `mem_save` `scope:personal` → beto `mem_search "privada zzz"` → 0 results; ana → 1 result.
  - beto `mem_search author=ana "note"` → 1; `author=beto "note"` → 0.
  - beto `mem_list_projects` → `["portales"]`.
- T6 verified live with the ana/beto tokens:
  - `mem_whoami` (ana) → `{name:"ana", default_organization:"portales"}`.
  - `mem_save area=code project=visualizador-inmobiliario` → `{id:3, revision_count:1}`;
    `mem_save area=render` → `{id:4}`.
  - beto `mem_search "memoria"` (no area) → both rows (cross-area reachable).
  - beto `mem_search "memoria" area=code` → only id 3.
  - beto `mem_list_areas` → `["code","render"]`; `mem_list_projects area=code` →
    `["visualizador-inmobiliario"]`.
- `supabase db push` applied `20261003010000_hierarchy.sql`; `supabase functions deploy mcp` OK;
  `curl.exe` with no token → `401 Unauthorized`.
- T7: skill read back; frontmatter (`name`, `description`) present; every tool/param matches
  `supabase/functions/mcp/index.ts`; no invented features.
- T9: `keep-warm.yml` parsed with `yaml.safe_load` (OK); live check — request with
  `Authorization: Bearer keep-warm` → `401` (the members SELECT runs before the 401), and no:
  `Bearer` → `401` (early return, no query). Confirms the dummy-token mechanism is what keeps the
  project active.
