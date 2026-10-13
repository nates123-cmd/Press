import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePress } from '../App'
import { loadArticle, loadComments, subscribeComments, upsertRead, addComment, editComment, deleteComment, resolveComment } from '../lib/press'
import { indexText, locate, markRange, clearMarks, anchorFromRange } from '../lib/anchor'
import { Panel } from './Panel'
import { agoPhrase, prettyUrl } from '../components/Feed'
import { Avatar } from '../components/Me'

function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

const Bubble = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 4.5h14v9H8l-4 3v-3H3z" strokeLinejoin="round" />
  </svg>
)

export function Reader({ id }) {
  const { me, byId } = usePress()
  const [a, setA] = useState(null)
  const [comments, setComments] = useState([])
  const [error, setError] = useState(null)
  const [panel, setPanel] = useState(false)
  const [active, setActive] = useState(null)       // thread id
  const [draft, setDraft] = useState(null)         // { quote, prefix, suffix } | { whole: true }
  const [pill, setPill] = useState(null)           // { x, y, anchor }
  const [showResolved, setShowResolved] = useState(false)
  const [readState, setReadState] = useState(null)
  const readerRef = useRef(null)
  const bodyRef = useRef(null)
  const footRef = useRef(null)
  // On a touch screen iOS draws its own callout over the selection, so the
  // affordance lives in a bar at the bottom instead of a pill at the text.
  const touch = useMedia('(pointer: coarse)')

  const reloadComments = useCallback(() => loadComments(id).then(setComments).catch((e) => setError(e.message)), [id])

  useEffect(() => {
    setA(null); setComments([]); setActive(null); setDraft(null); setPill(null); setPanel(false)
    loadArticle(id).then((row) => {
      setA(row)
      const mine = row.reads.find((r) => r.profile_id === me.id)
      setReadState(mine?.read_at || null)
      upsertRead(me.id, id, {}).catch(() => {})
    }).catch((e) => setError(e.message))
    reloadComments()
    return subscribeComments(id, reloadComments)
  }, [id, me.id, reloadComments])

  useEffect(() => {
    if (!a || readState || !footRef.current || a.status !== 'ready') return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { markRead(true); io.disconnect() }
    }, { rootMargin: '0px 0px -20% 0px' })
    io.observe(footRef.current)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, readState])

  const markRead = async (read) => {
    const when = read ? new Date().toISOString() : null
    setReadState(when)
    try { await upsertRead(me.id, id, { read_at: when }) } catch (e) { setError(e.message) }
  }

  const roots = useMemo(() => comments.filter((c) => !c.parent_id), [comments])
  const repliesOf = useMemo(() => {
    const m = {}
    for (const c of comments) if (c.parent_id) (m[c.parent_id] ||= []).push(c)
    return m
  }, [comments])
  const visibleRoots = useMemo(() => roots.filter((c) => showResolved || !c.resolved_at), [roots, showResolved])
  const resolvedCount = roots.filter((c) => c.resolved_at).length
  const liveCount = roots.length - resolvedCount

  // Paint highlights for every visible anchored thread, plus the draft.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !a?.content_html) return
    clearMarks(body)
    const { text } = indexText(body)
    const items = visibleRoots.filter((c) => c.quote).map((c) => ({ id: c.id, c }))
    if (draft?.quote) items.push({ id: 'draft', c: draft })
    for (const { id: cid, c } of items) {
      const pos = locate(text, c)
      if (pos < 0) continue
      const cls = [cid === active || cid === 'draft' ? 'active' : '', c.resolved_at ? 'resolved' : ''].join(' ').trim()
      markRange(body, pos, pos + c.quote.length, { 'data-cid': cid, class: cls })
    }
  }, [a?.content_html, visibleRoots, draft, active])

  // Selection inside the body -> floating "Comment" pill.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection()
      const body = bodyRef.current
      if (!sel || sel.isCollapsed || !body || !sel.rangeCount) { setPill(null); return }
      const range = sel.getRangeAt(0)
      if (!body.contains(range.commonAncestorContainer)) { setPill(null); return }
      const anchor = anchorFromRange(body, range)
      if (!anchor) { setPill(null); return }
      const rects = range.getClientRects()
      const r = rects[rects.length - 1] || range.getBoundingClientRect()
      const readerRect = readerRef.current.getBoundingClientRect()
      setPill({ x: r.left + r.width / 2 - readerRect.left, y: r.top - readerRect.top - 8, anchor })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const openPanel = (threadId = null) => { setActive(threadId); setPanel(true) }
  const closePanel = useCallback(() => { setPanel(false); setDraft(null); setActive(null) }, [])

  const startDraft = (anchor) => {
    setDraft(anchor); setActive(null); setPill(null); setPanel(true)
    document.getSelection()?.removeAllRanges()
  }

  const onBodyClick = (e) => {
    const mark = e.target.closest?.('mark[data-cid]')
    if (!mark) return
    const cid = mark.getAttribute('data-cid')
    if (cid !== 'draft') openPanel(cid)
  }

  const jumpTo = (cid) => {
    const mark = bodyRef.current?.querySelector(`mark[data-cid="${cid}"]`)
    if (!mark) return
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
    mark.classList.add('flash')
    setTimeout(() => mark.classList.remove('flash'), 1400)
  }

  const submit = async (body, parentId = null) => {
    if (!body.trim()) return
    const row = { article_id: id, author_id: me.id, body: body.trim(), parent_id: parentId }
    if (!parentId && draft?.quote) Object.assign(row, { quote: draft.quote, prefix: draft.prefix, suffix: draft.suffix })
    const created = await addComment(row)
    setComments((cs) => [...cs, created])
    if (!parentId) { setDraft(null); setActive(created.id) }
    upsertRead(me.id, id, {}).catch(() => {})
  }
  const handlers = {
    onReply: (parentId, body) => submit(body, parentId),
    onResolve: async (cid, resolved) => { await resolveComment(cid, resolved); await reloadComments() },
    onEdit: async (cid, body) => { await editComment(cid, body); await reloadComments() },
    onDelete: async (cid) => { await deleteComment(cid); await reloadComments(); if (active === cid) setActive(null) },
  }

  if (error) return <div className="status">{error}</div>
  if (!a) return <div className="status">Unfolding</div>

  const readers = a.reads.filter((r) => r.read_at).map((r) => byId[r.profile_id]).filter(Boolean)
  const heroInBody = a.hero_image_url && a.content_html && a.content_html.includes(a.hero_image_url.split('?')[0].slice(-40))
  const commentsButton = (
    <button className="comments-btn" onClick={() => openPanel(null)}>
      <Bubble /> {liveCount > 0 ? `Comments ${liveCount}` : 'Comment'}
    </button>
  )

  return (
    <div className="reader" ref={readerRef} onClick={onBodyClick}>
      <div className="reader-top">
        <a className="back" href="#/">Press Gang</a>
        <div className="tools">
          <a className="caps" href={a.url} target="_blank" rel="noopener">Open at {a.site}</a>
          {commentsButton}
        </div>
      </div>

      <div className="art-col">
        <header className="art-head">
          <div className="art-kicker">
            <span className="caps">{a.site}</span>
            {a.published_at && <span className="caps">{new Date(a.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>}
          </div>
          <h1 className="art-title">{a.title || prettyUrl(a.url)}</h1>
          {a.dek && <p className="art-dek">{a.dek}</p>}
          {(a.byline || a.word_count) && (
            <div className="art-byline">
              {a.byline && <span>By <b>{a.byline}</b></span>}
              {a.word_count ? <><span className="sep" /><span>{Math.max(1, Math.round(a.word_count / 240))} min read</span></> : null}
            </div>
          )}
          <hr className="rule" />
          <div className="art-shares">
            {a.shares.map((s) => {
              const p = byId[s.profile_id]
              return (
                <div className="share-line" key={s.id} style={{ '--who': p?.color }}>
                  <Avatar p={p} />
                  <div>
                    <div className="share-who">
                      {s.visibility === 'personal'
                        ? <><b>Just you</b>, added {agoPhrase(s.shared_at)}</>
                        : <><b>{p?.display_name || 'Someone'}</b> sent this {agoPhrase(s.shared_at)}</>}
                    </div>
                    {s.note && <p className="share-note">{s.note}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </header>

        {a.status === 'ready' && (
          <>
            {a.hero_image_url && !heroInBody && (
              <figure className="art-hero">
                <img src={a.hero_image_url} alt="" />
                {a.hero_caption && <figcaption>{a.hero_caption.replace(/^Credit\.{3}\s*/, 'Credit: ')}</figcaption>}
              </figure>
            )}
            <div className="art-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: a.content_html.replace(/Credit\.{3}\s*/g, 'Credit: ') }} />
          </>
        )}
        {a.status === 'pending' && <div className="link-only">Still fetching this one. <a href={a.url} target="_blank" rel="noopener">Read it at the source</a> in the meantime.</div>}
        {a.status === 'failed' && <div className="link-only">Could not fetch this one ({a.fetch_error || 'unknown'}). <a href={a.url} target="_blank" rel="noopener">Read it at the source.</a></div>}
        {a.status === 'link_only' && (
          <div className="link-only">
            {a.hero_image_url && <img src={a.hero_image_url} alt="" />}
            {a.dek && <p style={{ marginTop: 0 }}>{a.dek}</p>}
            <a href={a.url} target="_blank" rel="noopener">Open at {a.site}</a>
          </div>
        )}

        <div className="art-foot" ref={footRef}>
          <button className={`btn ${readState ? 'quiet' : ''}`} onClick={() => markRead(!readState)}>{readState ? 'Mark unread' : 'Mark read'}</button>
          {commentsButton}
          {readers.length > 0 && (
            <span className="readers">
              {readers.map((p) => <Avatar key={p.id} p={p} size="sm" />)}
              <span style={{ marginLeft: 8 }}>read it</span>
            </span>
          )}
        </div>
      </div>

      {pill && !touch && (
        <button className="sel-pill" style={{ left: pill.x, top: pill.y }} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); startDraft(pill.anchor) }}>
          Comment
        </button>
      )}
      {pill && touch && (
        <button className="sel-bar"
          onTouchStart={(e) => e.preventDefault()}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); startDraft(pill.anchor) }}
          onClick={(e) => { e.stopPropagation(); startDraft(pill.anchor) }}>
          Comment on this passage
        </button>
      )}

      <Panel
        open={panel}
        onClose={closePanel}
        roots={visibleRoots}
        repliesOf={repliesOf}
        byId={byId}
        me={me}
        active={active}
        onActivate={setActive}
        onJump={jumpTo}
        draft={draft}
        onDraftCancel={() => setDraft(null)}
        onSubmit={(body) => submit(body)}
        showResolved={showResolved}
        setShowResolved={setShowResolved}
        resolvedCount={resolvedCount}
        {...handlers}
      />
    </div>
  )
}
