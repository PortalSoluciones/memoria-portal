#!/usr/bin/env node
// Generate a NEW token for an existing member and store only its hash.
// The member keeps their id and all their observations; the old token stops working.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/rotate-token.mjs <name>

import { createHash, randomBytes } from 'node:crypto'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const [name] = process.argv.slice(2)

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) first.')
  process.exit(1)
}
if (!name) {
  console.error('Usage: node scripts/rotate-token.mjs <name>')
  process.exit(1)
}

const base = url.replace(/\/$/, '')
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

const token = randomBytes(32).toString('hex')
const token_hash = createHash('sha256').update(token).digest('hex')

const res = await fetch(`${base}/rest/v1/members?name=eq.${encodeURIComponent(name)}`, {
  method: 'PATCH',
  headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify({ token_hash }),
})
if (!res.ok) {
  console.error(`Rotate failed (${res.status}): ${await res.text()}`)
  process.exit(1)
}
const rows = await res.json()
if (rows.length === 0) {
  console.error(`No member named '${name}'.`)
  process.exit(1)
}

console.log(`New token for '${name}' (shown once - the old token is now invalid):`)
console.log(token)
