#!/usr/bin/env node
/**
 * Print a one-shot sign-in link for a member, for local development and for
 * checking the app in a browser without waiting on an email.
 *
 *   node scripts/dev-link.mjs <email> [redirect, default http://localhost:3000]
 *
 * Uses the service key from ~/Library/Application Support/press-poller/.env.
 * The user must already exist (scripts/invite.mjs); if it is the owner's own
 * address and no auth user exists yet, one is created first.
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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const email = (process.argv[2] || '').trim().toLowerCase()
const redirectTo = process.argv[3] || 'http://localhost:3000'
if (!email.includes('@')) { console.error('usage: dev-link.mjs <email> [redirect]'); process.exit(2) }

const { data: prof } = await sb.from('profiles').select('id, is_me, user_id').eq('email', email).maybeSingle()
if (!prof) { console.error('no profile with that email; invite first'); process.exit(1) }
if (!prof.user_id) {
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  if (data?.user) await sb.from('profiles').update({ user_id: data.user.id }).eq('id', prof.id)
}
const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } })
if (error) throw error
console.log(data.properties.action_link)
