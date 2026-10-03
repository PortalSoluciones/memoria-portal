// portales-memoria — stateless MCP server over Streamable HTTP.
// Bearer token -> SHA-256 (lowercase hex) -> members.token_hash; the resolved
// member is the caller (author + default project). Five tools, service-role
// access to Postgres: RLS is enabled with no policies, so all visibility
// rules (shared vs personal, soft delete) are enforced in this file.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4.1.13'

// ponytail: one service-role client per isolate; it is stateless, no singleton class needed.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type Caller = { id: string; name: string; default_project: string }
type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function authorize(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

  const { data, error } = await admin
    .from('members')
    .select('id, name, default_project')
    .eq('token_hash', hash)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true })

// Tool handlers never throw: unexpected errors surface as MCP tool errors.
const wrap =
  (fn: (args: any) => Promise<ToolResult>) =>
  async (args: any): Promise<ToolResult> => {
    try {
      return await fn(args)
    } catch (e) {
      console.error('tool error:', e)
      return fail(`error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

// Visible if shared, or personal and owned by the caller. caller.id comes from
// the DB (uuid), never from client input, so string interpolation is safe.
const visibleFilter = (callerId: string): string =>
  `scope.eq.shared,and(scope.eq.personal,author_id.eq.${callerId})`

const excerpt = (s: string): string => (s.length > 200 ? `${s.slice(0, 200)}...` : s)

const deriveTitle = (content: string): string => {
  const firstLine = content
    .split('\n')
    .map((l) => l.trim().replace(/^#+\s*/, ''))
    .find((l) => l.length > 0) ?? ''
  return (firstLine || 'Session summary').slice(0, 80)
}

const KEYWORDS = new Set(['and', 'or', 'not'])
const tokenize = (query: string): string[] =>
  (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => !KEYWORDS.has(t))

// ponytail: substring scoring (title > topic_key > content hits), not ts_rank —
// PostgREST cannot order by ts_rank without a SQL function, and this schema is
// frozen. Good enough for short team notes; revisit only if recall feels off.
const score = (row: any, terms: string[]): number => {
  const title = String(row.title).toLowerCase()
  const topic = String(row.topic_key ?? '').toLowerCase()
  const body = String(row.content).toLowerCase()
  let total = 0
  for (const t of terms) {
    if (title.includes(t)) total += 3
    if (topic.includes(t)) total += 2
    total += body.split(t).length - 1
  }
  return total
}

const clampLimit = (limit: number | undefined, fallback: number): number =>
  Math.min(Math.max(limit ?? fallback, 1), 50)

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function buildServer(caller: Caller): McpServer {
  const server = new McpServer({ name: 'portales-memoria', version: '0.1.0' })

  server.registerTool(
    'mem_save',
    {
      description:
        'Persist an observation. With topic_key it upserts: saving the same (project, scope, topic_key) again updates the row and bumps revision_count instead of creating a duplicate. The author is always the caller.',
      inputSchema: {
        title: z.string().min(1).describe('Short searchable title'),
        content: z.string().min(1).describe('Full observation content (Markdown allowed)'),
        type: z.string().min(1).optional().describe("Category, e.g. 'manual', 'decision', 'bugfix'. Default 'manual'"),
        project: z.string().min(1).optional().describe("Defaults to the caller's default_project"),
        scope: z.enum(['shared', 'personal']).optional().describe("Visibility. Default 'shared'"),
        topic_key: z.string().min(1).optional().describe('Stable key for evolving topics; reuse it to update instead of duplicating'),
      },
    },
    wrap(async (args: {
      title: string
      content: string
      type?: string
      project?: string
      scope?: 'shared' | 'personal'
      topic_key?: string
    }) => {
      const title = args.title
      const content = args.content
      const type = args.type ?? 'manual'
      const project = args.project ?? caller.default_project
      const scope = args.scope ?? 'shared'
      const topicKey = args.topic_key ?? null

      const findTopic = async (key: string): Promise<{ id: number; revision_count: number } | null> => {
        let q = admin
          .from('observations')
          .select('id, revision_count')
          .eq('project', project)
          .eq('scope', scope)
          .eq('topic_key', key)
          .is('deleted_at', null)
        if (scope === 'personal') q = q.eq('author_id', caller.id)
        const { data, error } = await q.maybeSingle()
        if (error) throw new Error(error.message)
        return data
      }

      // ponytail: read-modify-write for revision_count (no SQL expression support
      // in PostgREST); a concurrent save can lose one increment, harmless counter.
      const bump = async (row: { id: number; revision_count: number }): Promise<ToolResult> => {
        const { data, error } = await admin
          .from('observations')
          .update({
            title,
            content,
            type,
            revision_count: row.revision_count + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .select('id, revision_count')
        if (error) throw new Error(error.message)
        return ok({ id: data[0].id, revision_count: data[0].revision_count, created: false })
      }

      if (topicKey) {
        const existing = await findTopic(topicKey)
        if (existing) return bump(existing)
      }

      const { data, error } = await admin
        .from('observations')
        .insert({
          project,
          author_id: caller.id,
          scope,
          type,
          title,
          content,
          topic_key: topicKey,
        })
        .select('id, revision_count')
      if (error) {
        // 23505: lost the insert race for this topic_key — retry as an update.
        if (error.code === '23505' && topicKey) {
          const existing = await findTopic(topicKey)
          if (existing) return bump(existing)
        }
        throw new Error(error.message)
      }
      return ok({ id: data[0].id, revision_count: data[0].revision_count, created: true })
    }),
  )

  server.registerTool(
    'mem_search',
    {
      description:
        'Full-text search (Postgres websearch, config "simple") over non-deleted observations visible to the caller, best matches first then most recent.',
      inputSchema: {
        query: z.string().min(1).describe('Search text; supports quotes, OR and NOT'),
        project: z.string().min(1).optional().describe("Defaults to the caller's default_project"),
        scope: z.enum(['shared', 'personal']).optional().describe('Restrict to one scope'),
        author: z.string().min(1).optional().describe('Restrict to one member by name'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results. Default 10, max 50'),
      },
    },
    wrap(async (args: {
      query: string
      project?: string
      scope?: 'shared' | 'personal'
      author?: string
      limit?: number
    }) => {
      const project = args.project ?? caller.default_project
      const limit = clampLimit(args.limit, 10)

      let authorId: string | null = null
      if (args.author !== undefined) {
        const { data, error } = await admin.from('members').select('id').eq('name', args.author).maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) return ok({ results: [], count: 0 })
        authorId = data.id
      }

      let q = admin
        .from('observations')
        .select('id, project, scope, type, title, content, topic_key, created_at, author:members(name)')
        .eq('project', project)
        .is('deleted_at', null)
        .textSearch('search', args.query, { type: 'websearch', config: 'simple' })
        .or(visibleFilter(caller.id))
      if (args.scope) q = q.eq('scope', args.scope)
      if (authorId) q = q.eq('author_id', authorId)

      // ponytail: pull the newest 4x the limit and rank in JS (see score() above).
      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit * 4)
      if (error) throw new Error(error.message)

      const terms = tokenize(args.query)
      const results = (data ?? [])
        .map((row: any) => ({
          id: row.id,
          project: row.project,
          scope: row.scope,
          type: row.type,
          title: row.title,
          author: row.author?.name ?? null,
          created_at: row.created_at,
          excerpt: excerpt(row.content),
          _score: score(row, terms),
        }))
        .sort((a, b) => b._score - a._score) // stable: ties keep created_at desc
        .slice(0, limit)
        .map(({ _score, ...rest }) => rest)

      return ok({ results, count: results.length })
    }),
  )

  server.registerTool(
    'mem_context',
    {
      description: 'Most recent non-deleted observations visible to the caller, newest first.',
      inputSchema: {
        project: z.string().min(1).optional().describe("Defaults to the caller's default_project"),
        scope: z.enum(['shared', 'personal']).optional().describe('Restrict to one scope'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results. Default 10, max 50'),
      },
    },
    wrap(async (args: { project?: string; scope?: 'shared' | 'personal'; limit?: number }) => {
      const project = args.project ?? caller.default_project
      const limit = clampLimit(args.limit, 10)

      let q = admin
        .from('observations')
        .select('id, title, type, scope, created_at, author:members(name)')
        .eq('project', project)
        .is('deleted_at', null)
        .or(visibleFilter(caller.id))
      if (args.scope) q = q.eq('scope', args.scope)

      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
      if (error) throw new Error(error.message)

      const results = (data ?? []).map((row: any) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        scope: row.scope,
        author: row.author?.name ?? null,
        created_at: row.created_at,
      }))
      return ok({ results, count: results.length })
    }),
  )

  server.registerTool(
    'mem_get_observation',
    {
      description: 'Fetch one observation by id with its full content. Tool error if deleted or not visible to the caller.',
      inputSchema: {
        id: z.number().int().positive().describe('Observation id'),
      },
    },
    wrap(async (args: { id: number }) => {
      const { data, error } = await admin
        .from('observations')
        .select(
          'id, project, scope, type, title, content, topic_key, revision_count, author_id, created_at, updated_at, author:members(name)',
        )
        .eq('id', args.id)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data || (data.scope === 'personal' && data.author_id !== caller.id)) {
        return fail(`Observation ${args.id} not found or not visible to you`)
      }
      return ok({
        id: data.id,
        project: data.project,
        scope: data.scope,
        type: data.type,
        title: data.title,
        content: data.content,
        topic_key: data.topic_key,
        revision_count: data.revision_count,
        author: data.author?.name ?? null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      })
    }),
  )

  server.registerTool(
    'mem_session_summary',
    {
      description:
        "Save a session summary (type 'session_summary'): what was done, key discoveries, and what remains.",
      inputSchema: {
        content: z.string().min(1).describe('Full summary content (Markdown allowed)'),
        title: z.string().min(1).optional().describe('Defaults to the first line of content, truncated to 80 chars'),
        project: z.string().min(1).optional().describe("Defaults to the caller's default_project"),
        scope: z.enum(['shared', 'personal']).optional().describe("Visibility. Default 'shared'"),
      },
    },
    wrap(async (args: { content: string; title?: string; project?: string; scope?: 'shared' | 'personal' }) => {
      const project = args.project ?? caller.default_project
      const scope = args.scope ?? 'shared'
      const title = args.title ?? deriveTitle(args.content)

      const { data, error } = await admin
        .from('observations')
        .insert({
          project,
          author_id: caller.id,
          scope,
          type: 'session_summary',
          title,
          content: args.content,
        })
        .select('id')
      if (error) throw new Error(error.message)
      return ok({ id: data[0].id })
    }),
  )

  server.registerTool(
    'mem_whoami',
    {
      description: 'Return the authenticated caller (id, name, default project). Use it to verify token wiring.',
      inputSchema: {},
    },
    wrap(async () => ok({ id: caller.id, name: caller.name, default_project: caller.default_project })),
  )

  server.registerTool(
    'mem_list_projects',
    {
      description:
        "List project names visible to the caller, plus the caller's default project. Use it to discover where memories live.",
      inputSchema: {},
    },
    wrap(async () => {
      // ponytail: PostgREST has no DISTINCT, so select the project column of visible rows and
      // dedupe in JS. Fine at team scale; add an RPC if the table ever grows large.
      const { data, error } = await admin
        .from('observations')
        .select('project')
        .is('deleted_at', null)
        .or(visibleFilter(caller.id))
      if (error) throw new Error(error.message)
      const projects = new Set<string>((data ?? []).map((row: any) => row.project as string))
      projects.add(caller.default_project)
      return ok({ projects: [...projects].sort() })
    }),
  )

  return server
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  let caller: Caller | null = null
  try {
    caller = await authorize(req)
  } catch (e) {
    console.error('auth lookup failed:', e)
    return new Response('Internal Server Error', { status: 500 })
  }
  if (!caller) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="portales-memoria"' },
    })
  }

  // Stateless mode: fresh server + transport per request, no MCP session id.
  const server = buildServer(caller)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return await transport.handleRequest(req)
})
