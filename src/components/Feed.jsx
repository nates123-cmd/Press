import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePress, go } from '../App'
import { loadFeed, subscribeFeed, shareUrl } from '../lib/press'

const TABS = [
  { key: 'unread', label: 'Unread' },
  { key: 'all', label: 'Everything' },
  { key: 'links', label: 'Links' },
]

export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* "3h ago" while it is recent, "on Sep 23" once it is not. */
export function agoPhrase(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  return s < 86400 * 14 ? `${ago(iso)} ago` : `on ${ago(iso)}`
}

export function Feed() {
  const { me, byId } = usePress()
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('press-tab') || 'unread' } catch { return 'unread' } })
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => loadFeed().then(setRows).catch((e) => setError(e.message)), [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => subscribeFeed(() => refresh()), [refresh])
  useEffect(() => { try { localStorage.setItem('press-tab', tab) } catch {} }, [tab])

  const decorated = useMemo(() => {
    if (!rows) return null
    return rows.map((a) => {
      const mine = a.reads.find((r) => r.profile_id === me.id)
      const seen = mine?.last_seen_at || '1970'
      const live = a.comments.filter((c) => !c.resolved_at)
      return {
        ...a,
        isRead: !!mine?.read_at,
        isLink: a.kind === 'link' || a.status === 'link_only',
        newComments: live.filter((c) => c.created_at > seen && c.author_id !== me.id).length,
        commentCount: live.length,
        sharers: [...new Set(a.shares.map((s) => s.profile_id))],
        note: a.shares.find((s) => s.note)?.note || null,
      }
    })
  }, [rows, me.id])

  const visible = useMemo(() => {
    if (!decorated) return []
    if (tab === 'unread') return decorated.filter((a) => !a.isRead && !a.isLink && a.status !== 'failed')
    if (tab === 'links') return decorated.filter((a) => a.isLink)
    return decorated.filter((a) => !a.isLink)
  }, [decorated, tab])

  const counts = useMemo(() => ({
    unread: decorated?.filter((a) => !a.isRead && !a.isLink && a.status !== 'failed').length,
    all: decorated?.filter((a) => !a.isLink).length,
    links: decorated?.filter((a) => a.isLink).length,
  }), [decorated])

  const add = async (e) => {
    e.preventDefault()
    const url = adding.trim()
    if (!/^https?:\/\//.test(url) || busy) return
    setBusy(true)
    try { const id = await shareUrl(me.id, url, null); setAdding(''); await refresh(); go(`#/a/${id}`) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  if (error) return <div className="status">{error}</div>
  if (!decorated) return <div className="status">Fetching the pile</div>

  return (
    <main className="feed">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}<span className="count">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <hr className="rule" />

      {visible.length === 0 && (
        <div className="feed-empty">{tab === 'unread' ? 'Nothing unread. The group is quiet, or you are caught up.' : 'Nothing here yet.'}</div>
      )}

      {visible.map((a) => <Row key={a.id} a={a} byId={byId} />)}

      <form className="add-form" onSubmit={add}>
        <input type="url" placeholder="Paste a link that never made it to the chat" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <button className="btn quiet" type="submit" disabled={busy || !adding}>Add</button>
      </form>
    </main>
  )
}

function Row({ a, byId }) {
  const first = byId[a.sharers[0]]
  const who = a.sharers.map((id) => byId[id]?.short_name || '?')
  const whoText = who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`
  const title = a.title || prettyUrl(a.url)
  const pending = a.status === 'pending'
  const failed = a.status === 'failed'
  const external = a.isLink || failed
  const href = external ? a.url : `#/a/${a.id}`
  return (
    <a className={`row ${a.isRead ? 'is-read' : ''} ${a.isLink && a.hero_image_url ? 'has-thumb' : ''}`} href={href}
      target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}
      style={{ '--who': first?.color }}>
      <span className="row-bar" />
      <div>
        <h2 className="row-title">
          {!a.isRead && !a.isLink && <span className="unread" aria-label="unread" />}
          {title}
          {a.isLink && <span className="row-kind">{a.site.replace(/^open\./, '')}</span>}
        </h2>
        {a.dek && !a.isLink && <p className="row-dek">{a.dek}</p>}
        {a.note && <p className="row-note">{a.note}</p>}
        <div className="row-meta">
          {!a.isLink && <span>{a.site}</span>}
          {a.byline && !a.isLink && <><span className="sep" /><span>{a.byline}</span></>}
          {a.word_count ? <><span className="sep" /><span>{Math.max(1, Math.round(a.word_count / 240))} min</span></> : null}
          <span className="sep" /><span className="who">{whoText}</span>
          <span>{ago(a.latest_share)}</span>
          {a.commentCount > 0 && <><span className="sep" /><span className={a.newComments ? 'new' : ''}>{a.commentCount} {a.commentCount === 1 ? 'comment' : 'comments'}{a.newComments ? `, ${a.newComments} new` : ''}</span></>}
          {pending && <><span className="sep" /><span>fetching</span></>}
          {failed && <><span className="sep" /><span>could not fetch, opens the source</span></>}
        </div>
      </div>
      {a.isLink && a.hero_image_url && <img className="row-thumb" src={a.hero_image_url} alt="" loading="lazy" />}
    </a>
  )
}

export function prettyUrl(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '') } catch { return u }
}
