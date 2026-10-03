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

Give the printed token to that member; it is never stored in plaintext. The **secret key** (`sb_secret_...`,
which replaced the legacy `service_role` key) is required because `members` has RLS enabled; the
publishable key (`sb_publishable_...`) will not work.

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

Codex, Cursor, Windsurf and VS Code Copilot use the same URL plus the `Authorization` header.

> Harnesses that only support local (stdio) MCP would need a small bridge that carries the token from
> the environment and proxies stdio to this HTTP endpoint. It is not needed for the harnesses above;
> add it only if one is adopted.

## Tools

| Tool | Purpose |
|------|---------|
| `mem_save` | Save an observation; upserts on `topic_key`; author from the token |
| `mem_search` | Full-text search; optional `project`, `scope`, `author` filters |
| `mem_context` | Recent observations, newest first, with author |
| `mem_get_observation` | Full content by id |
| `mem_session_summary` | Save an end-of-session summary |
| `mem_list_projects` | Projects the caller can see, plus the default |
| `mem_whoami` | The calling member (verify token wiring) |

Defaults: `project` = the member's `default_project` (`portales`); `scope` = `shared`. A memory with
`scope: personal` is visible only to its author.

## Notes

- **Free tier**: the project pauses after 7 days without database activity. Keep it warm with a daily
  minimal query (e.g. a GitHub Actions cron hitting the function) or move to Pro.
- **Token rotation**: create a new token for the member and update the row, or delete and re-add.
- **Search** uses Postgres full-text (`simple` config, no stemming) so Spanish prose and English
  identifiers both tokenize predictably.
