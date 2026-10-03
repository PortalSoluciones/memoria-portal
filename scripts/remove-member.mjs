#!/usr/bin/env node
// Remove a portales-memoria member and every observation they authored.
//
// Cleanup/offboarding tool: HARD-deletes data. A member cannot be removed while they
// have observations (observations.author_id is ON DELETE RESTRICT), so their
// observations are deleted first.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/remove-member.mjs <name>

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const [name] = process.argv.slice(2)

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) first.')
  process.exit(1)
}
if (!name) {
  console.error('Usage: node scripts/remove-member.mjs <name>')
  process.exit(1)
}

const base = url.replace(/\/$/, '')
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

const found = await fetch(`${base}/rest/v1/members?name=eq.${encodeURIComponent(name)}&select=id`, { headers })
if (!found.ok) {
  console.error(`Lookup failed (${found.status}): ${await found.text()}`)
  process.exit(1)
}
const rows = await found.json()
if (rows.length === 0) {
  console.error(`No member named '${name}'.`)
  process.exit(1)
}
const id = rows[0].id

const delObs = await fetch(`${base}/rest/v1/observations?author_id=eq.${id}`, { method: 'DELETE', headers })
if (!delObs.ok) {
  console.error(`Observation delete failed (${delObs.status}): ${await delObs.text()}`)
  process.exit(1)
}

const delMem = await fetch(`${base}/rest/v1/members?id=eq.${id}`, { method: 'DELETE', headers })
if (!delMem.ok) {
  console.error(`Member delete failed (${delMem.status}): ${await delMem.text()}`)
  process.exit(1)
}

console.log(`Removed member '${name}' and their observations.`)
