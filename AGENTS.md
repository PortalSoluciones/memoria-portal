# AGENTS.md — install the Portales memory

This repository is **portales-memoria**, the Portales team's shared agent memory. This file is the
install guide an agent follows to connect a member's machine. The repo is public; read it without
cloning.

## Your job

Install the MCP server and the skill, then hand the **token** step to the member. **Do not ask the
member for their token, do not accept it, and do not write it into any file.** The config reads the
token from the environment variable `PORTALES_MEMORY_TOKEN`, which the member sets themselves.

1. Add the MCP server — section 1.
2. Install the skill — section 2.
3. Tell the member how to set their token and restart — section 3.
4. Verify once they have restarted — section 4.

## 1. Add the MCP server

Endpoint: `https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp`

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

## 2. Install the skill

Copy `skills/portales-memory/` into the harness skills directory — `~/.config/opencode/skills/`,
`~/.claude/skills/`, or `~/.agents/skills/` — or reference `skills/portales-memory/SKILL.md` from the
project's `AGENTS.md` / `CLAUDE.md`.

## 3. Explain the token to the member (they do it, not you)

Each member has a personal token. If they do not have one, tell them to ask an admin (the admin runs
`node scripts/add-member.mjs <name> portales`, which prints the token once). Then tell the member to,
themselves:

1. Set it in their environment and never commit it:
   - macOS/Linux (add to `~/.zshrc` or `~/.bashrc`, then reopen the terminal):
     `export PORTALES_MEMORY_TOKEN="<their token>"`
   - Windows PowerShell (persists for future sessions; reopen the terminal):
     `setx PORTALES_MEMORY_TOKEN "<their token>"`
2. Restart the harness so the environment and the MCP config load.

Do not run these for them, do not ask them to paste the token into the chat, and do not store it in any
file. The member owns the token.

## 4. Verify

After the member restarts, call `mem_whoami`; it must return their name. A `401` means the token is not
set or is wrong — repeat section 3.

- `mem_list_areas` → `code`, `render`, `diseno`, `arte`, `redes` (the valid `area` values).
- `mem_list_projects` → the projects already in the team memory.

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
