#!/usr/bin/env node
/**
 * Put headshots on profiles.
 *
 *   node scripts/avatars.mjs <folder>
 *
 * Every PNG or JPG in the folder whose basename matches a profile's short
 * name (case-insensitive) is uploaded to the public `avatars` bucket and
 * written to that profile's avatar_url. The bucket is created on first run.
 * Keep the files small (320px is plenty); they are hotlinked on every row.
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
const folder = process.argv[2]
if (!folder || !fs.existsSync(folder)) { console.error('usage: avatars.mjs <folder of <shortname>.png>'); process.exit(2) }

const { data: buckets } = await sb.storage.listBuckets()
if (!buckets?.some((b) => b.name === 'avatars')) {
  const { error } = await sb.storage.createBucket('avatars', { public: true, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] })
  if (error) throw error
  console.log('created bucket avatars')
}

const { data: profiles, error } = await sb.from('profiles').select('id, short_name, display_name')
if (error) throw error

for (const file of fs.readdirSync(folder)) {
  const m = file.match(/^(.+)\.(png|jpe?g|webp)$/i)
  if (!m) continue
  const key = m[1].toLowerCase()
  const p = profiles.find((x) => x.short_name.toLowerCase() === key || x.display_name.toLowerCase().split(' ')[0] === key)
  if (!p) { console.log('no profile for', file); continue }
  const ext = m[2].toLowerCase() === 'jpg' ? 'jpeg' : m[2].toLowerCase()
  const objectPath = `${p.id}.${ext === 'jpeg' ? 'jpg' : ext}`
  const { error: upErr } = await sb.storage.from('avatars').upload(objectPath, fs.readFileSync(path.join(folder, file)), { contentType: `image/${ext}`, upsert: true })
  if (upErr) throw upErr
  const { data: pub } = sb.storage.from('avatars').getPublicUrl(objectPath)
  const url = `${pub.publicUrl}?v=${Date.now()}`
  const { error: updErr } = await sb.from('profiles').update({ avatar_url: url }).eq('id', p.id)
  if (updErr) throw updErr
  console.log(p.display_name, '<-', file)
}
