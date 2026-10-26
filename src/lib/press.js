/* All reads and writes against the Press project. Components never touch
 * supabase directly. */
import { supabase } from './supabase'
import { canonicalize, siteOf, kindOf } from './url'

export async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('id, user_id, display_name, short_name, color, is_me, avatar_url, solo').order('created_at')
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

const FEED_COLS = `id, url, canonical_url, site, kind, status, title, byline, dek, published_at, hero_image_url, word_count, created_at, attempts, fetch_error, claimed_at, queued_at,
  shares (id, profile_id, note, shared_at, visibility),
  comments (id, author_id, parent_id, created_at, resolved_at),
  reads (profile_id, read_at, last_seen_at, dismissed_at, moved_at)`

export async function loadFeed() {
  const { data, error } = await supabase.from('articles').select(FEED_COLS).order('created_at', { ascending: false }).limit(400)
  if (error) throw error
  for (const a of data) a.latest_share = a.shares.length ? a.shares.reduce((m, s) => (s.shared_at > m ? s.shared_at : m), '') : a.created_at
  data.sort((a, b) => (a.latest_share < b.latest_share ? 1 : -1))
  return data
}

/* The readers' heartbeats: { beelink: {...}, mac: {...} }. */
export async function loadWorkers() {
  const { data, error } = await supabase.from('press_workers').select('name, last_seen_at, last_ok_at, note')
  if (error) throw error
  return Object.fromEntries(data.map((w) => [w.name, w]))
}

/* Ask for another go at a link that failed or is stuck. */
export async function retryFetch(articleId) {
  const { error } = await supabase.rpc('press_retry', { p_article_id: articleId })
  if (error) throw error
}

export async function loadArticle(id) {
  const { data, error } = await supabase
    .from('articles')
    .select(`*, shares (id, profile_id, note, shared_at, raw_url, visibility), reads (profile_id, read_at, last_seen_at)`)
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shares' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'press_workers' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

/* Add a link by hand: to the group feed, or just for yourself. */
export async function shareUrl(profileId, rawUrl, note, visibility = 'group') {
  const canon = canonicalize(rawUrl)
  const site = siteOf(canon)
  // Find-or-create as a definer: a solo member cannot see an article the group already has.
  const { data: articleId, error: artError } = await supabase.rpc('press_ensure_article', {
    p_canonical: canon, p_url: rawUrl, p_site: site, p_kind: kindOf(site),
  })
  if (artError) throw artError
  const { error } = await supabase.from('shares').insert({
    article_id: articleId, profile_id: profileId, raw_url: rawUrl, note: note || null, source: 'app', visibility,
  })
  if (error) throw error
  return articleId
}

/* Delete every share of mine on this article. If nobody else sent it, it
 * leaves the feed for everyone. */
export async function deleteMyShares(profileId, articleId) {
  const { error } = await supabase.from('shares').delete().eq('article_id', articleId).eq('profile_id', profileId)
  if (error) throw error
}

/* Flip my own shares of this article between the group feed and Just me. */
export async function setMyShareVisibility(profileId, articleId, visibility) {
  const { error } = await supabase.from('shares').update({ visibility }).eq('article_id', articleId).eq('profile_id', profileId)
  if (error) throw error
}

/* Also load the article detail's shares with visibility so the reader can say "just you". */
export async function loadArticleShares(articleId) {
  const { data, error } = await supabase.from('shares').select('id, profile_id, note, shared_at, raw_url, visibility').eq('article_id', articleId).order('shared_at')
  if (error) throw error
  return data
}

/* Outside the group: a read-only link to one article, no sign-in. The token
 * is minted once per article and reused, so sharing twice gives one link.
 * The link goes through press.nsteph.com (share/server.py on the Beelink) so
 * message previews show the article; it 302s people to #/s/<token> here. */
const SHARE_HOST = 'https://press.nsteph.com'
export async function publicShareLink(articleId) {
  const { data, error } = await supabase.rpc('press_share_article', { p_article_id: articleId })
  if (error) throw error
  return `${SHARE_HOST}/s/${data}`
}

export async function loadPublicArticle(token) {
  const { data, error } = await supabase.rpc('press_public_article', { p_token: token })
  if (error) throw error
  return data?.[0] || null
}
