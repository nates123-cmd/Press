import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in env')
}

/* Press has its own Supabase project, so its session key is its own too:
 * nothing here is shared with the suite apps on the same github.io origin. */
export const supabase = createClient(url, anonKey, {
  auth: { storageKey: 'press-auth', persistSession: true, autoRefreshToken: true },
})
