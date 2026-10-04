#!/usr/bin/env node
// Create a portales-memoria member.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/add-member.mjs <name> [default_organization]
//
// Prints the raw token ONCE. Store it as that member's PORTALES_MEMORY_TOKEN; only its
// SHA-256 is kept in the database (members.token_hash). No dependencies: uses global fetch.

import { createHash, randomBytes } from 'node:crypto'

const url = process.env.SUPABASE_URL
// New key name (sb_secret_...) or the legacy service_role name; both are the RLS-bypassing secret.
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const [name, defaultOrganization = 'portales'] = process.argv.slice(2)

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) first.')
  process.exit(1)
}
if (!name) {
  console.error('Usage: node scripts/add-member.mjs <name> [default_organization]')
  process.exit(1)
}

const token = randomBytes(32).toString('hex')
const token_hash = createHash('sha256').update(token).digest('hex')

const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/members`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({ name, token_hash, default_organization: defaultOrganization }),
})

if (!res.ok) {
  console.error(`Failed (${res.status}): ${await res.text()}`)
  process.exit(1)
}

console.log(`Member '${name}' created (default organization: ${defaultOrganization}).`)
console.log('Token (shown once - store it as PORTALES_MEMORY_TOKEN, do not commit):')
console.log(token)
