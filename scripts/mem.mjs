#!/usr/bin/env node
// portales-memoria CLI — dependency-free (Node 18+). Talks to the MCP endpoint
// over Streamable HTTP: in stateless mode a tools/call is a single POST.
//
//   PORTALES_MEMORY_TOKEN=… node mem.mjs whoami
//   … node mem.mjs areas
//   … node mem.mjs projects [--area code]
//   … node mem.mjs save <area> <title> <content> [--project P] [--scope shared|personal] [--type T] [--topic K]
//   … node mem.mjs search <query> [--area A] [--project P] [--scope S] [--author X] [--limit N]
//   … node mem.mjs context [--area A] [--project P] [--scope S] [--limit N]
//   node mem.mjs --selftest
const ENDPOINT =
  process.env.PORTALES_MEMORY_URL ?? 'https://vfjgwyiqlesbuudhulcf.supabase.co/functions/v1/mcp'

// Server-sent events: keep only the `data:` payload(s) and parse the JSON.
function parseSse(text) {
  const data = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('')
  return data ? JSON.parse(data) : null
}

// MCP tool results wrap text in content[0].text, sometimes itself JSON.
function unwrap(msg) {
  if (msg?.error) throw new Error(`MCP error: ${msg.error.message ?? JSON.stringify(msg.error)}`)
  const res = msg?.result
  if (!res) return res
  const text = res.content?.[0]?.text ?? ''
  if (res.isError) throw new Error(text)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function call(name, args = {}) {
  const token = process.env.PORTALES_MEMORY_TOKEN
  if (!token) throw new Error('PORTALES_MEMORY_TOKEN is not set')
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const text = await r.text()
  if (r.status === 401) throw new Error('401 Unauthorized — check PORTALES_MEMORY_TOKEN')
  if (!r.ok && !text.startsWith('event:')) throw new Error(`HTTP ${r.status}: ${text}`)
  return unwrap(parseSse(text))
}

function flags(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i]
    else out._.push(argv[i])
  }
  return out
}

const commands = {
  whoami: () => call('mem_whoami'),
  areas: () => call('mem_list_areas'),
  projects: ({ area }) => call('mem_list_projects', area ? { area } : {}),
  save: ({ _: [area, title, content], project, scope, type, topic }) => {
    if (!area || !title || !content) {
      throw new Error('usage: save <area> <title> <content> [--project P] [--scope S] [--type T] [--topic K]')
    }
    return call('mem_save', { area, title, content, project, scope, type, topic_key: topic })
  },
  search: ({ _: [query], area, project, scope, author, limit }) => {
    if (!query) throw new Error('usage: search <query> [--area A] [--project P] [--scope S] [--author X] [--limit N]')
    const args = { query }
    if (area) args.area = area
    if (project) args.project = project
    if (scope) args.scope = scope
    if (author) args.author = author
    if (limit) args.limit = Number(limit)
    return call('mem_search', args)
  },
  context: ({ area, project, scope, limit }) => {
    const args = {}
    if (area) args.area = area
    if (project) args.project = project
    if (scope) args.scope = scope
    if (limit) args.limit = Number(limit)
    return call('mem_context', args)
  },
}

function selftest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`selftest failed: ${msg}`)
  }
  const sse = 'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"a\\":1}"}]},"jsonrpc":"2.0","id":1}\n'
  assert(parseSse(sse).result !== undefined, 'parseSse returns the message')
  const value = unwrap(parseSse(sse))
  assert(value.a === 1, 'unwrap parses JSON-in-text')
  let threw = false
  try {
    unwrap({ result: { isError: true, content: [{ type: 'text', text: 'boom' }] } })
  } catch (e) {
    threw = e.message === 'boom'
  }
  assert(threw, 'unwrap throws on isError')
  console.log('selftest OK')
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === '--selftest') {
  selftest()
} else if (!commands[cmd]) {
  console.error(`usage: mem.mjs <${Object.keys(commands).join('|')}> [args]  (env: PORTALES_MEMORY_TOKEN)`)
  process.exit(1)
} else {
  commands[cmd](flags(rest))
    .then((r) => console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
