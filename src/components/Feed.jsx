import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePress, go } from '../App'
import { loadFeed, loadWorkers, retryFetch, subscribeFeed, shareUrl, upsertRead, deleteMyShares, setMyShareVisibility } from '../lib/press'
import { fetchState } from '../lib/fetchState'
import { Avatar } from './Me'

const SWIPE = 88 // px of travel that commits a swipe
const HOLD = 480  // ms a still finger takes to open the row's actions

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

  const [undo, setUndo] = useState({})   // article id -> true while its "Dismissed, undo" line shows
  const [acting, setActing] = useState(null) // the row whose long-press sheet is open

  /* The readers' heartbeats and a clock that ticks while anything is still
   * fetching, so "in queue 40s" keeps counting without a reload. The workers
   * table is optional: if it cannot be read the row just says "in queue". */
  const [workers, setWorkers] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const refresh = useCallback(() => Promise.all([
    loadFeed().then(setRows).catch((e) => setError(e.message)),
    loadWorkers().then(setWorkers).catch(() => setWorkers(null)),
  ]), [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => subscribeFeed(() => refresh()), [refresh])
  const anyPending = !!rows?.some((a) => a.status === 'pending')
  useEffect(() => {
    if (!anyPending) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(t)
  }, [anyPending])
  const retry = useCallback((a) => {
    setRows((rs) => rs && rs.map((r) => r.id !== a.id ? r : { ...r, status: 'pending', attempts: 0, fetch_error: null, claimed_at: null, queued_at: new Date().toISOString() }))
    retryFetch(a.id).catch(() => refresh())
  }, [refresh])
  useEffect(() => { try { localStorage.setItem('press-tab', tab) } catch {} }, [tab])

  /* Swipes: change the row locally first, then write. A failed write
   * reloads the feed so the screen never lies for long. */
  const patchMyRead = useCallback((articleId, patch) => {
    setRows((rs) => rs && rs.map((a) => {
      if (a.id !== articleId) return a
      const others = a.reads.filter((r) => r.profile_id !== me.id)
      const mine = a.reads.find((r) => r.profile_id === me.id) || { profile_id: me.id, read_at: null, last_seen_at: null, dismissed_at: null }
      return { ...a, reads: [...others, { ...mine, ...patch }] }
    }))
    upsertRead(me.id, articleId, patch).catch(() => refresh())
  }, [me.id, refresh])
  const toggleRead = useCallback((a) => patchMyRead(a.id, { read_at: a.isRead ? null : new Date().toISOString() }), [patchMyRead])
  const dismiss = useCallback((a) => { patchMyRead(a.id, { dismissed_at: new Date().toISOString() }); setUndo((u) => ({ ...u, [a.id]: true })) }, [patchMyRead])
  const undismiss = useCallback((a) => { patchMyRead(a.id, { dismissed_at: null }); setUndo((u) => { const n = { ...u }; delete n[a.id]; return n }) }, [patchMyRead])

  /* Long-press actions. Same rule as the swipes: change the rows locally,
   * write, reload on failure. */
  const patchMyShares = useCallback((articleId, fn) => {
    setRows((rs) => rs && rs.map((a) => a.id !== articleId ? a : { ...a, shares: fn(a.shares) }))
  }, [])
  const moveToMine = useCallback((a) => {
    // My own shares go personal for real; a link someone else sent moves only for me.
    if (a.myGroupShares) {
      patchMyShares(a.id, (ss) => ss.map((s) => s.profile_id === me.id ? { ...s, visibility: 'personal' } : s))
      setMyShareVisibility(me.id, a.id, 'personal').catch(() => refresh())
    }
    if (a.othersGroupShares) patchMyRead(a.id, { moved_at: new Date().toISOString() })
  }, [me.id, patchMyShares, patchMyRead, refresh])
  const moveToGroup = useCallback((a) => {
    if (a.myShares.some((s) => s.visibility === 'personal')) {
      patchMyShares(a.id, (ss) => ss.map((s) => s.profile_id === me.id ? { ...s, visibility: 'group' } : s))
      setMyShareVisibility(me.id, a.id, 'group').catch(() => refresh())
    }
    if (a.isMoved) patchMyRead(a.id, { moved_at: null })
  }, [me.id, patchMyShares, patchMyRead, refresh])
  const removeMine = useCallback((a) => {
    patchMyShares(a.id, (ss) => ss.filter((s) => s.profile_id !== me.id))
    deleteMyShares(me.id, a.id).catch(() => refresh())
  }, [me.id, patchMyShares, refresh])

  const decorated = useMemo(() => {
    if (!rows) return null
    return rows
      .map((a) => {
        const mine = a.reads.find((r) => r.profile_id === me.id)
        const seen = mine?.last_seen_at || '1970'
        const live = a.comments.filter((c) => !c.resolved_at)
        const group = a.shares.filter((s) => s.visibility !== 'personal')
        const personal = a.shares.filter((s) => s.visibility === 'personal' && s.profile_id === me.id)
        const moved = !!mine?.moved_at && group.length > 0
        const visible = group.length && (!moved || !personal.length) ? group : personal
        const myShares = a.shares.filter((s) => s.profile_id === me.id)
        return {
          ...a,
          inGroup: group.length > 0 && !moved,
          inMine: personal.length > 0 || moved,
          isMoved: moved,
          myShares,
          myGroupShares: myShares.some((s) => s.visibility !== 'personal'),
          othersGroupShares: group.some((s) => s.profile_id !== me.id),
          isRead: !!mine?.read_at,
          isDismissed: !!mine?.dismissed_at,
          isLink: a.kind === 'link' || a.status === 'link_only',
          newComments: live.filter((c) => c.created_at > seen && c.author_id !== me.id).length,
          commentCount: live.length,
          sharers: [...new Set(visible.map((s) => s.profile_id))],
          note: visible.find((s) => s.note)?.note || null,
          latest_share: visible.reduce((m, s) => (s.shared_at > m ? s.shared_at : m), ''),
        }
      })
      // RLS hides other people's personal shares, so an article with no visible share is theirs alone.
      // A dismissed row stays only while its undo line is showing.
      .filter((a) => (a.inGroup || a.inMine) && (!a.isDismissed || undo[a.id]))
      .sort((a, b) => (a.latest_share < b.latest_share ? 1 : -1))
  }, [rows, me.id, undo])

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
      <button className="fab" aria-label="Add a link" onClick={() => setAdding(true)}>+</button>
      <hr className="rule" />

      {visible.length === 0 && (
        <div className="feed-empty">
          {tab === 'unread' && 'Nothing unread. The group is quiet, or you are caught up.'}
          {tab === 'mine' && 'Nothing here yet. Add a link and choose "Just me" to keep it off the group feed.'}
          {(tab === 'all' || tab === 'links') && 'Nothing here yet.'}
        </div>
      )}

      {visible.map((a) => a.isDismissed
        ? (
          <div key={a.id} className="row-undo">
            <span>Dismissed.</span>
            <button className="linklike" onClick={() => undismiss(a)}>Undo</button>
          </div>
        )
        : <Row key={a.id} a={a} byId={byId} me={me} fetch={fetchState(a, workers, now)} onRead={() => toggleRead(a)} onDismiss={() => dismiss(a)} onHold={() => setActing(a.id)} />)}

      {acting && decorated.find((a) => a.id === acting) && (
        <ActionSheet a={decorated.find((a) => a.id === acting)} me={me} byId={byId} onClose={() => setActing(null)}
          fetch={fetchState(decorated.find((a) => a.id === acting), workers, now)}
          onRead={toggleRead} onDismiss={dismiss} onMine={moveToMine} onGroup={moveToGroup} onDelete={removeMine} onRetry={retry} />
      )}

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
        <div className="hint">It lands as "in queue" and gets its headline in about 2 min. NYT and WSJ read from Nate's Mac, so they wait while it sleeps.</div>
      </form>
    </>
  )
}

/* Touch swipes on a row: right marks it read (or unread again), left dismisses.
 * The row follows the finger once the gesture is clearly sideways; vertical
 * scrolling is untouched. A finger held still opens the row's actions, and so
 * does a right-click (or Android's long-press, which arrives as contextmenu).
 * A committed swipe or hold swallows the click that would otherwise open the
 * article. */
function useSwipe({ onRight, onLeft, onHold, disabled }) {
  const ref = useRef(null)
  const [dx, setDx] = useState(0)
  const dxRef = useRef(0)   // the live travel; state alone lags a frame behind the finger
  const state = useRef({ x: 0, y: 0, axis: null, committed: false })
  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return
    let timer = null
    const cancelHold = () => { clearTimeout(timer); timer = null }
    const hold = () => {
      timer = null
      state.current.committed = true
      state.current.axis = 'held'
      navigator.vibrate?.(10)
      onHold?.()
    }
    const start = (e) => {
      const t = e.touches[0]
      state.current = { x: t.clientX, y: t.clientY, axis: null, committed: false }
      cancelHold()
      if (onHold && e.touches.length === 1) timer = setTimeout(hold, HOLD)
    }
    const move = (e) => {
      const s = state.current
      const t = e.touches[0]
      const mx = t.clientX - s.x, my = t.clientY - s.y
      if (s.axis === 'held') { e.preventDefault(); return }
      if (!s.axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
        cancelHold()
        s.axis = Math.abs(mx) > Math.abs(my) * 1.3 ? 'x' : 'y'
      }
      if (s.axis !== 'x') return
      e.preventDefault()
      const capped = Math.max(-160, Math.min(160, mx))
      dxRef.current = capped
      setDx(capped)
    }
    const end = (e) => {
      cancelHold()
      const s = state.current
      // Lifting a held finger would click whatever is under it now, the sheet's scrim.
      if (s.axis === 'held' && e.cancelable) e.preventDefault()
      if (s.axis === 'x') {
        if (dxRef.current >= SWIPE) { s.committed = true; onRight() }
        else if (dxRef.current <= -SWIPE) { s.committed = true; onLeft() }
      }
      dxRef.current = 0
      setDx(0)
    }
    const click = (e) => { if (state.current.committed) { e.preventDefault(); e.stopPropagation(); state.current.committed = false } }
    const menu = (e) => {
      if (!onHold) return
      e.preventDefault()
      // A touch hold already opened the sheet; this is the same press arriving again.
      if (state.current.axis === 'held') return
      onHold()
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    el.addEventListener('click', click, true)
    el.addEventListener('contextmenu', menu)
    return () => {
      cancelHold(); el.removeEventListener('contextmenu', menu)
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); el.removeEventListener('click', click, true)
    }
  }, [onRight, onLeft, onHold, disabled])
  return { ref, dx }
}

function Row({ a, byId, me, fetch, onRead, onDismiss, onHold }) {
  const { ref: swipeRef, dx } = useSwipe({ onRight: onRead, onLeft: onDismiss, onHold, disabled: !onRead })
  const first = byId[a.sharers[0]]
  const who = a.inGroup || a.isMoved
    ? a.sharers.map((id) => byId[id]?.short_name || '?')
    : ['Just you']
  const whoText = who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`
  const title = a.title || prettyUrl(a.url)
  const failed = a.status === 'failed'
  const external = a.isLink || failed
  const href = external ? a.url : `#/a/${a.id}`
  const armed = dx >= SWIPE ? 'right' : dx <= -SWIPE ? 'left' : ''
  return (
    <div className={`swipe ${dx > 0 ? 'dir-right' : dx < 0 ? 'dir-left' : ''} ${armed}`}>
      <span className="swipe-label swipe-right">{a.isRead ? 'Unread' : 'Read'}</span>
      <span className="swipe-label swipe-left">Dismiss</span>
    <a ref={swipeRef} className={`row ${a.isRead ? 'is-read' : ''} ${a.hero_image_url ? 'has-thumb' : ''}`} href={href}
      target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}
      style={{ '--who': a.inGroup ? first?.color : me.color, transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : undefined }}>
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
          <span className="sep" />
          {(a.inGroup || a.isMoved) && a.sharers.map((id) => byId[id]?.avatar_url ? <Avatar key={id} p={byId[id]} size="sm" /> : null)}
          <span className="who">{whoText}</span>
          {a.latest_share && <span>{ago(a.latest_share)}</span>}
          {a.commentCount > 0 && <><span className="sep" /><span className={a.newComments ? 'new' : ''}>{a.commentCount} {a.commentCount === 1 ? 'comment' : 'comments'}{a.newComments ? `, ${a.newComments} new` : ''}</span></>}
          {fetch && <><span className="sep" /><span className={`fetch ${fetch.tone}`}>{fetch.text}</span></>}
        </div>
      </div>
      {a.hero_image_url && <img className="row-thumb" src={a.hero_image_url} alt="" loading="lazy" />}
    </a>
    </div>
  )
}

/* What a long-press offers. Read and dismiss work on anything. Moving to
 * Just me works on anything too: my own shares go personal for everyone,
 * a link someone else sent moves only for me. Delete is only ever for my
 * own shares; if somebody else also sent it, their share stays. */
function ActionSheet({ a, me, byId, fetch, onClose, onRead, onDismiss, onMine, onGroup, onDelete, onRetry }) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const act = (fn) => () => { fn(a); onClose() }
  const opened = useRef(Date.now())
  const scrim = () => { if (Date.now() - opened.current > 400) onClose() }
  const others = [...new Set(a.shares
    .filter((s) => s.profile_id !== me.id && s.visibility !== 'personal')
    .map((s) => byId[s.profile_id]?.short_name || 'someone'))]
  const deleteLabel = others.length ? 'Remove my share' : a.myGroupShares ? 'Delete for the group' : 'Delete'
  const deleteHint = others.length
    ? `${others.join(' and ')} sent it too, so it stays in the feed.`
    : a.myGroupShares ? "Gone from everyone's feed." : 'Gone from your Just me tab.'
  const mineHint = a.myGroupShares && !a.othersGroupShares
    ? 'Off the group feed for everyone, kept under your Just me tab.'
    : a.myGroupShares ? 'Your share goes private. The others still see theirs.' : 'Off your group tabs, under Just me. Nobody else notices.'
  const backToGroup = !a.inGroup && (a.isMoved || a.myShares.some((s) => s.visibility === 'personal'))
  return (
    <>
      <div className="panel-scrim open" onClick={scrim} />
      <div className="act-sheet" role="dialog" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
        <div className="act-title">{a.title || prettyUrl(a.url)}</div>
        {fetch && <div className="act-fetch">{fetch.text}</div>}
        {fetch?.retry && <button className="act" onClick={act(onRetry)}>Try again<span>Back to the front of the queue with a clean slate.</span></button>}
        {!a.isLink && <button className="act" onClick={act(onRead)}>{a.isRead ? 'Mark as unread' : 'Mark as read'}</button>}
        <button className="act" onClick={act(onDismiss)}>Dismiss<span>Hidden for you only.</span></button>
        {a.inGroup && <button className="act" onClick={act(onMine)}>Move to Just me<span>{mineHint}</span></button>}
        {backToGroup && (
          <button className="act" onClick={act(onGroup)}>Move to the group feed<span>{a.myShares.some((s) => s.visibility === 'personal') ? 'Everyone sees it, like a link in the chat.' : 'Back on your group tabs.'}</span></button>
        )}
        {a.myShares.length > 0 && (confirm
          ? <button className="act danger armed" onClick={act(onDelete)}>Tap again to {deleteLabel.toLowerCase()}<span>{deleteHint}</span></button>
          : <button className="act danger" onClick={() => setConfirm(true)}>{deleteLabel}<span>{deleteHint}</span></button>)}
        <button className="act cancel" onClick={onClose}>Cancel</button>
      </div>
    </>
  )
}

export function prettyUrl(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '') } catch { return u }
}
