import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePress, go } from '../App'
import { loadFeed, subscribeFeed, shareUrl } from '../lib/press'

const TABS = [
  { key: 'unread', label: 'Unread' },
  { key: 'all', label: 'Everything' },
  { key: 'mine', label: 'Just me' },
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
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(() => loadFeed().then(setRows).catch((e) => setError(e.message)), [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => subscribeFeed(() => refresh()), [refresh])
  useEffect(() => { try { localStorage.setItem('press-tab', tab) } catch {} }, [tab])

  const decorated = useMemo(() => {
    if (!rows) return null
    return rows
      .map((a) => {
        const mine = a.reads.find((r) => r.profile_id === me.id)
        const seen = mine?.last_seen_at || '1970'
        const live = a.comments.filter((c) => !c.resolved_at)
        const group = a.shares.filter((s) => s.visibility !== 'personal')
        const personal = a.shares.filter((s) => s.visibility === 'personal' && s.profile_id === me.id)
        const visible = group.length ? group : personal
        return {
          ...a,
          inGroup: group.length > 0,
          inMine: personal.length > 0,
          isRead: !!mine?.read_at,
          isLink: a.kind === 'link' || a.status === 'link_only',
          newComments: live.filter((c) => c.created_at > seen && c.author_id !== me.id).length,
          commentCount: live.length,
          sharers: [...new Set(visible.map((s) => s.profile_id))],
          note: visible.find((s) => s.note)?.note || null,
          latest_share: visible.reduce((m, s) => (s.shared_at > m ? s.shared_at : m), ''),
        }
      })
      // RLS hides other people's personal shares, so an article with no visible share is theirs alone.
      .filter((a) => a.inGroup || a.inMine)
      .sort((a, b) => (a.latest_share < b.latest_share ? 1 : -1))
  }, [rows, me.id])

  const visible = useMemo(() => {
    if (!decorated) return []
    if (tab === 'unread') return decorated.filter((a) => a.inGroup && !a.isRead && !a.isLink && a.status !== 'failed')
    if (tab === 'mine') return decorated.filter((a) => a.inMine)
    if (tab === 'links') return decorated.filter((a) => a.inGroup && a.isLink)
    return decorated.filter((a) => a.inGroup && !a.isLink)
  }, [decorated, tab])

  const counts = useMemo(() => ({
    unread: decorated?.filter((a) => a.inGroup && !a.isRead && !a.isLink && a.status !== 'failed').length,
    all: decorated?.filter((a) => a.inGroup && !a.isLink).length,
    mine: decorated?.filter((a) => a.inMine).length,
    links: decorated?.filter((a) => a.inGroup && a.isLink).length,
  }), [decorated])

  if (error) return <div className="status">{error}</div>
  if (!decorated) return <div className="status">Fetching the pile</div>

  return (
    <main className="feed">
      <div className="tabs-row">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}<span className="count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <button className="add-btn" onClick={() => setAdding(true)}>+ Add a link</button>
      </div>
      <hr className="rule" />

      {visible.length === 0 && (
        <div className="feed-empty">
          {tab === 'unread' && 'Nothing unread. The group is quiet, or you are caught up.'}
          {tab === 'mine' && 'Nothing here yet. Add a link and choose "Just me" to keep it off the group feed.'}
          {(tab === 'all' || tab === 'links') && 'Nothing here yet.'}
        </div>
      )}

      {visible.map((a) => <Row key={a.id} a={a} byId={byId} me={me} />)}

      {adding && <AddSheet me={me} defaultScope={tab === 'mine' ? 'personal' : 'group'} onClose={() => setAdding(false)} onDone={async (id) => { setAdding(false); await refresh(); go(`#/a/${id}`) }} />}
    </main>
  )
}

function AddSheet({ me, defaultScope, onClose, onDone }) {
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [scope, setScope] = useState(defaultScope)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const submit = async (e) => {
    e.preventDefault()
    const u = url.trim()
    if (!/^https?:\/\/\S+$/.test(u) || busy) { setError('Paste a full link, starting with http.'); return }
    setBusy(true); setError(null)
    try { const id = await shareUrl(me.id, u, note.trim() || null, scope); await onDone(id) }
    catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <>
      <div className="panel-scrim open" onClick={onClose} />
      <form className="add-sheet" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="add-head">
          <span className="panel-title">Add a link</span>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <label className="add-label">Link
          <input type="url" autoFocus required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="add-label">A line for the others, optional
          <input type="text" placeholder="Why this one" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
        </label>
        <div className="scope" role="radiogroup" aria-label="Who sees it">
          <button type="button" role="radio" aria-checked={scope === 'group'} onClick={() => setScope('group')}>
            <b>Group feed</b><span>Everyone sees it, like a link in the chat.</span>
          </button>
          <button type="button" role="radio" aria-checked={scope === 'personal'} onClick={() => setScope('personal')}>
            <b>Just me</b><span>Lands under the "Just me" tab. Nobody else sees it.</span>
          </button>
        </div>
        {error && <div className="err">{error}</div>}
        <div className="add-actions">
          <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn solid" disabled={busy || !url}>{busy ? 'Adding' : 'Add'}</button>
        </div>
        <div className="hint">It shows up as "fetching" first and gets its headline within a minute or two.</div>
      </form>
    </>
  )
}

function Row({ a, byId, me }) {
  const first = byId[a.sharers[0]]
  const who = a.inGroup
    ? a.sharers.map((id) => byId[id]?.short_name || '?')
    : ['Just you']
  const whoText = who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`
  const title = a.title || prettyUrl(a.url)
  const pending = a.status === 'pending'
  const failed = a.status === 'failed'
  const external = a.isLink || failed
  const href = external ? a.url : `#/a/${a.id}`
  return (
    <a className={`row ${a.isRead ? 'is-read' : ''} ${a.hero_image_url ? 'has-thumb' : ''}`} href={href}
      target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}
      style={{ '--who': a.inGroup ? first?.color : me.color }}>
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
          {a.latest_share && <span>{ago(a.latest_share)}</span>}
          {a.commentCount > 0 && <><span className="sep" /><span className={a.newComments ? 'new' : ''}>{a.commentCount} {a.commentCount === 1 ? 'comment' : 'comments'}{a.newComments ? `, ${a.newComments} new` : ''}</span></>}
          {pending && <><span className="sep" /><span>fetching</span></>}
          {failed && <><span className="sep" /><span>could not fetch, opens the source</span></>}
        </div>
      </div>
      {a.hero_image_url && <img className="row-thumb" src={a.hero_image_url} alt="" loading="lazy" />}
    </a>
  )
}

export function prettyUrl(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '') } catch { return u }
}
