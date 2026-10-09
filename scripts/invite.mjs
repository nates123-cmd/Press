#!/usr/bin/env node
/**
 * Name a Press Gang member and invite them.
 *
 *   node scripts/invite.mjs "<display name>" <email> [<iMessage handle like +16175551234>] [<short name>]
 *   node scripts/invite.mjs --list
 *
 * The poller already created a placeholder profile ("Friend 1234") for every
 * handle it saw in the chat, so pass the handle to rename that row and attach
 * the email. The email is also created as an auth user up front, because the
 * app sends codes with shouldCreateUser: false: only an invited address ever
 * receives one.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from
 * ~/Library/Application Support/press-poller/.env (or the environment).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envPath = path.join(os.homedir(), 'Library/Application Support/press-poller/.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('need SUPABASE_URL and SUPABASE_SERVICE_KEY'); process.exit(2) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const [a, b, c, d] = process.argv.slice(2)

if (a === '--list' || !a) {
  const { data, error } = await sb.from('profiles').select('display_name, short_name, email, imessage_handle, user_id, color').order('created_at')
  if (error) throw error
  for (const p of data) console.log(`${p.display_name.padEnd(22)} ${(p.short_name || '').padEnd(6)} ${(p.email || '(no email)').padEnd(30)} ${p.imessage_handle || ''}  ${p.user_id ? 'signed in' : 'not yet'}`)
  process.exit(0)
}

const displayName = a
const email = (b || '').trim().toLowerCase()
const handle = c && c.startsWith('+') ? c : null
const shortName = d || (c && !c.startsWith('+') ? c : displayName.split(' ')[0])
if (!email.includes('@')) { console.error('usage: invite.mjs "<name>" <email> [+1handle] [short]'); process.exit(2) }

let row = null
if (handle) {
  const { data } = await sb.from('profiles').select('id').eq('imessage_handle', handle).maybeSingle()
  row = data
}
if (!row) {
  const { data } = await sb.from('profiles').select('id').eq('email', email).maybeSingle()
  row = data
}
const patch = { display_name: displayName, short_name: shortName, email }
if (handle) patch.imessage_handle = handle
if (row) {
  const { error } = await sb.from('profiles').update(patch).eq('id', row.id)
  if (error) throw error
  console.log('updated profile', row.id)
} else {
  const { data, error } = await sb.from('profiles').insert(patch).select('id').single()
  if (error) throw error
  row = data
  console.log('created profile', row.id)
}

// Create the auth user so the OTP gate (shouldCreateUser: false) lets them in.
const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 })
const existing = users?.users?.find((u) => (u.email || '').toLowerCase() === email)
if (existing) {
  console.log('auth user exists', existing.id)
  await sb.from('profiles').update({ user_id: existing.id }).eq('id', row.id).is('user_id', null)
} else {
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  console.log('auth user created', data.user.id)
  // The auth trigger binds profiles.user_id by email; make sure it landed.
  await sb.from('profiles').update({ user_id: data.user.id }).eq('id', row.id).is('user_id', null)
}
console.log(`${displayName} <${email}> can now sign in to Press.`)
