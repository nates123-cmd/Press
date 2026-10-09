/* All reads and writes against the Press project. Components never touch
 * supabase directly. */
import { supabase } from './supabase'
import { canonicalize, siteOf, kindOf } from './url'

export async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('id, user_id, display_name, short_name, color, is_me').order('created_at')
  if (error) throw error
  return data
}

export async function myProfileId() {
  const { data, error } = await supabase.rpc('press_me')
  if (error) throw error
  return data
}

export async function updateMe(id, patch) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  if (error) throw error
}

const FEED_COLS = `id, url, canonical_url, site, kind, status, title, byline, dek, published_at, hero_image_url, word_count, created_at,
  shares (id, profile_id, note, shared_at),
  comments (id, author_id, parent_id, created_at, resolved_at),
  reads (profile_id, read_at, last_seen_at)`

export async function loadFeed() {
  const { data, error } = await supabase.from('articles').select(FEED_COLS).order('created_at', { ascending: false }).limit(400)
  if (error) throw error
  for (const a of data) a.latest_share = a.shares.length ? a.shares.reduce((m, s) => (s.shared_at > m ? s.shared_at : m), '') : a.created_at
  data.sort((a, b) => (a.latest_share < b.latest_share ? 1 : -1))
  return data
}

export async function loadArticle(id) {
  const { data, error } = await supabase
    .from('articles')
    .select(`*, shares (id, profile_id, note, shared_at, raw_url), reads (profile_id, read_at, last_seen_at)`)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function loadComments(articleId) {
  const { data, error } = await supabase.from('comments').select('*').eq('article_id', articleId).order('created_at')
  if (error) throw error
  return data
}

export async function upsertRead(profileId, articleId, patch) {
  const row = { profile_id: profileId, article_id: articleId, last_seen_at: new Date().toISOString(), ...patch }
  const { error } = await supabase.from('reads').upsert(row, { onConflict: 'profile_id,article_id' })
  if (error) throw error
}

export async function addComment(row) {
  const { data, error } = await supabase.from('comments').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function editComment(id, body) {
  const { error } = await supabase.from('comments').update({ body, edited_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

export async function resolveComment(id, resolved) {
  const { error } = await supabase.rpc('press_resolve', { comment_id: id, resolved })
  if (error) throw error
}

export function subscribeComments(articleId, onChange) {
  const ch = supabase
    .channel(`comments:${articleId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `article_id=eq.${articleId}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

export function subscribeFeed(onChange) {
  const ch = supabase
    .channel('feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shares' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

/* The in-app fallback for a link that never went through the chat. */
export async function shareUrl(profileId, rawUrl, note) {
  const canon = canonicalize(rawUrl)
  const site = siteOf(canon)
  let { data: art } = await supabase.from('articles').select('id').eq('canonical_url', canon).maybeSingle()
  if (!art) {
    const { data, error } = await supabase
      .from('articles')
      .insert({ canonical_url: canon, url: rawUrl, site, kind: kindOf(site) })
      .select('id')
      .single()
    if (error) throw error
    art = data
  }
  const { error } = await supabase.from('shares').insert({ article_id: art.id, profile_id: profileId, raw_url: rawUrl, note: note || null, source: 'app' })
  if (error) throw error
  return art.id
}
