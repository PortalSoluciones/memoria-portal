---
name: portales-memory
description: Save to the Portales shared memory whenever you make a decision, fix a bug, discover something non-obvious, establish a convention, change configuration, or end a session; and search it before starting work on a topic that may have prior memory. Use it only while working on a Portales project.
---

# portales-memory

Shared, always-online team memory: Supabase Postgres behind one MCP Edge Function over Streamable
HTTP. Endpoint `https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp`, bearer token per member
read from env `PORTALES_MEMORY_TOKEN`. Harness connection config: see the repo README.

## Only for Portales projects

This memory belongs to the Portales team. Save **only** when the work you are doing is a Portales
project. The organization is fixed to `portales`, but nothing in the server checks the project, so
this rule is on you:

- Before saving, confirm the project is ours: the repo is under the Portales org
  (e.g. `github.com/PortalSoluciones/...`), or it is a project the memory already knows (check with
  `mem_list_projects`), or you know it is ours.
- If you are working on anything unrelated — a personal repo, another company, another client — do
  **not** save here, even though the MCP is connected. Keep that knowledge out of the team memory.
- If you are unsure, do not save. Reading (`mem_search` / `mem_context`) is low-risk, but the same
  intent applies: do not fill the team memory with foreign work.

## When to save

Save at the moment it happens, not later. Saving is internal bookkeeping — it never replaces your
actual reply to the user, and a memory the user never sees in chat is not an answer.

| Event | Tool |
|-------|------|
| Architecture / design decision | `mem_save` (`type: decision`) |
| Bug fix with root cause | `mem_save` (`type: bugfix`) |
| Non-obvious discovery or gotcha | `mem_save` (`type: discovery`) |
| Convention or pattern established | `mem_save` (`type: pattern`) |
| Configuration or environment change | `mem_save` (`type: config`) |
| Learned user preference | `mem_save` (`type: preference`) |
| End of session | `mem_session_summary` |

```
mem_save(title, content, type?, area?, project?, scope?, topic_key?)
mem_session_summary(content, title?, area?, project?, scope?)
```

`type` defaults to `'manual'`. The author is always the token's member — never a parameter.

## Choosing area / project

The organization is always the caller's (`portales`) and is automatic — never pass it.
Hierarchy: organization -> `area` -> `project`.

- `area` = work domain. Already in use: `code`, `render`, `diseno`, `arte`, `redes`.
- `project` = concrete product or repo, e.g. `visualizador-inmobiliario`.

Omit both only for genuinely organization-wide memory. If unsure, call `mem_list_areas()` or
`mem_list_projects(area?)`.

## shared vs personal

Default `scope` is `shared`: the whole team sees it, attributed to you. Use `personal` only for
private scratch you do not want teammates to read.

## topic_key

For an evolving topic, reuse a stable `topic_key` so a re-save updates one row and bumps
`revision_count` instead of duplicating it. Do not use it for one-off events.

## Recall

At the START of work on a topic that may have prior memory, search first:

```
mem_search(query, area?, project?, scope?, author?, limit?)
mem_context(area?, project?, scope?, limit?)
mem_get_observation(id)
```

Use `mem_get_observation` for the full, untruncated content of a search hit. Search and context
default to the whole organization; `area`/`project` narrow the results.

## Install per harness

Copy or symlink this skill directory into a harness skills dir — Claude Code `~/.claude/skills/`,
OpenCode `~/.config/opencode/skills/`, generic `~/.agents/skills/` — or reference this file from
`AGENTS.md` / `CLAUDE.md`.

## Other tools

`mem_whoami()` verifies token wiring; `mem_list_areas()` and `mem_list_projects(area?)` enumerate
what exists in your organization.
