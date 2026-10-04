# portales-memoria

Shared, always-online memory for the Portales team's coding agents. One Postgres source of truth on
Supabase, exposed over MCP, with per-member attribution. Five people work on the same project and
every memory records who saved it. No server to run.

## Architecture

```
Agent (any MCP harness)  --MCP/Streamable HTTP-->  Supabase Edge Function (mcp)  -->  Postgres
                                                      bearer token -> members          observations
```

- **Backend**: Supabase Postgres (project `vfjgwyiqlesbuudhulcf`). Single copy of the truth: a write
  is visible to the next read by anyone, with no sync step.
- **Access**: one Edge Function `mcp` speaking standard MCP over Streamable HTTP. Auth is a bearer
  token per member (SHA-256 -> `members.token_hash`). The author of a memory is always the token's
  member, never a parameter.
- **RLS is enabled with no policies**: the Data API sees nothing; the function uses the service role
  and enforces `shared` vs `personal` visibility in its own logic.

## Deploy

```sh
supabase link --project-ref vfjgwyiqlesbuudhulcf
supabase db push
supabase functions deploy mcp
```

`supabase/config.toml` sets `[functions.mcp] verify_jwt = false` so our own token auth is used
instead of a Supabase JWT.

## Onboard a member

Each teammate gets one token. The script generates it, stores only its hash, and prints the token once.

```sh
SUPABASE_URL=https://vfjgwyiqlesbuudhulcf.supabase.co \
SUPABASE_SECRET_KEY=<secret-key> \
node scripts/add-member.mjs ana portales
```

Give the printed token to that member; it is never stored in plaintext. The member sets it as
`PORTALES_MEMORY_TOKEN` on their own machine — don't paste it into a chat or hand it to an agent. The
**secret key** (`sb_secret_...`, which replaced the legacy `service_role` key) is required because
`members` has RLS enabled; the publishable key (`sb_publishable_...`) will not work.

Remove a member and every observation they authored (offboarding / test cleanup):

```sh
SUPABASE_URL=https://vfjgwyiqlesbuudhulcf.supabase.co \
SUPABASE_SECRET_KEY=<secret-key> \
node scripts/remove-member.mjs ana
```

Rotate a member's token (keeps their memories; the old token stops working):

```sh
SUPABASE_URL=https://vfjgwyiqlesbuudhulcf.supabase.co \
SUPABASE_SECRET_KEY=<secret-key> \
node scripts/rotate-token.mjs ana
```

## Connect an agent

The server is plain MCP, so any harness that supports remote MCP works. Set the member's token in
`PORTALES_MEMORY_TOKEN` and point the client at the function URL.

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "portales-memory": {
      "type": "remote",
      "url": "https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp",
      "headers": { "Authorization": "Bearer {env:PORTALES_MEMORY_TOKEN}" }
    }
  }
}
```

**Claude Code**:

```sh
claude mcp add --transport http portales-memory \
  https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer $PORTALES_MEMORY_TOKEN"
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.portales-memory]
url = "https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp"
bearer_token_env_var = "PORTALES_MEMORY_TOKEN"
```

Cursor, Windsurf and VS Code Copilot use the same URL plus an `Authorization: Bearer <token>` header.

Every harness reads the token from the environment `PORTALES_MEMORY_TOKEN`, which each member sets on
their own machine — never commit it. **Agents can install all of this themselves**: give the agent the
repo URL and it follows `AGENTS.md`.

> Harnesses that only support local (stdio) MCP can use the CLI (`scripts/mem.mjs`, below) instead of a
> bridge.

## CLI (optional)

`scripts/mem.mjs` is a dependency-free Node 18+ CLI against the same endpoint — for scripting and for
harnesses that only support local (stdio) MCP:

```sh
PORTALES_MEMORY_TOKEN=… node scripts/mem.mjs whoami
PORTALES_MEMORY_TOKEN=… node scripts/mem.mjs areas
PORTALES_MEMORY_TOKEN=… node scripts/mem.mjs search "topic" --area code
PORTALES_MEMORY_TOKEN=… node scripts/mem.mjs save code "Title" "Content" --project my-project
```

## Tools

| Tool | Purpose |
|------|---------|
| `mem_save` | Save an observation (`area` required); upserts on `topic_key`; author from the token |
| `mem_search` | Full-text search; optional `area`, `project`, `scope`, `author` filters |
| `mem_context` | Recent observations, newest first, with author |
| `mem_get_observation` | Full content by id |
| `mem_session_summary` | Save an end-of-session summary |
| `mem_list_areas` | The team's fixed areas (the valid `area` values) |
| `mem_list_projects` | Projects in the caller's organization (optionally within one area) |
| `mem_whoami` | The calling member (verify token wiring) |

Memory is scoped by a 3-level hierarchy: **organization → area → project**. The organization is always
the caller's `default_organization` (`portales`). On saves, `area` is **required** and must be one of
`code`, `render`, `diseno`, `arte`, `redes`; `project` is optional. Search and context default to the
**whole organization** — everything is reachable — and `area`/`project` narrow the result. `scope`
defaults to `shared`; a `personal` memory is visible only to its author.

## Notes

- **Free tier**: the project pauses after 7 days without database activity. Keep it warm with a daily
  minimal query (e.g. a GitHub Actions cron hitting the function) or move to Pro.
- **Token rotation**: create a new token for the member and update the row, or delete and re-add.
- **Search** uses Postgres full-text (`simple` config, no stemming) so Spanish prose and English
  identifiers both tokenize predictably.
