# AGENTS.md — install the Portales memory

This repository is **portales-memoria**, the Portales team's shared agent memory. This file is the
install guide an agent can follow to connect a member's machine to it. The repo is public, so it can
be read without cloning.

## What to install

- **MCP server** `portales-memory` — shared memory at
  `https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp`, authenticated with a per-member bearer token.
- **Skill** `skills/portales-memory/SKILL.md` — when to save, and the rule to save only for Portales projects.

## 1. Token

Each member has a personal token (an admin runs `node scripts/add-member.mjs <name> portales` and prints
it once). Export it; never commit it.

```sh
export PORTALES_MEMORY_TOKEN="…"     # macOS/Linux
$env:PORTALES_MEMORY_TOKEN = "…"     # Windows PowerShell
```

## 2. Connect the MCP server

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

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.portales-memory]
url = "https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp"
bearer_token_env_var = "PORTALES_MEMORY_TOKEN"
```

Or: `codex mcp add portales-memory --url https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp --bearer-token-env-var PORTALES_MEMORY_TOKEN`

**Claude Code**:

```sh
claude mcp add --transport http portales-memory \
  https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer $PORTALES_MEMORY_TOKEN"
```

**Anything else** that supports remote MCP: same URL plus an `Authorization: Bearer <token>` header.

## 3. Install the skill

Copy `skills/portales-memory/` into the harness skills directory — `~/.config/opencode/skills/`,
`~/.claude/skills/`, or `~/.agents/skills/` — or reference `skills/portales-memory/SKILL.md` from the
project's `AGENTS.md` / `CLAUDE.md`.

## 4. Verify

Call `mem_whoami`; it must return the member's name. A `401` means the token is missing or wrong.
`mem_list_areas` / `mem_list_projects` should show the team's existing memory.

## CLI (optional)

`scripts/mem.mjs` is a dependency-free Node 18+ CLI against the same endpoint — for scripting and for
harnesses that only support local (stdio) MCP. It needs `PORTALES_MEMORY_TOKEN`:

```sh
node scripts/mem.mjs whoami
node scripts/mem.mjs areas
node scripts/mem.mjs projects [--area code]
node scripts/mem.mjs save <area> <title> <content> [--project P] [--scope shared|personal] [--topic K]
node scripts/mem.mjs search "<query>" [--area A] [--project P] [--limit N]
node scripts/mem.mjs context [--area A] [--limit N]
```
