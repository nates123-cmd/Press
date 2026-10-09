import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePress } from '../App'
import { loadArticle, loadComments, subscribeComments, upsertRead, addComment, editComment, deleteComment, resolveComment } from '../lib/press'
import { indexText, locate, markRange, clearMarks, anchorFromRange } from '../lib/anchor'
import { Rail, ThreadCard, DraftCard } from './Rail'
import { agoPhrase, prettyUrl } from '../components/Feed'
import { initials } from '../components/Me'

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

export function Reader({ id }) {
  const { me, byId } = usePress()
  const [a, setA] = useState(null)
  const [comments, setComments] = useState([])
  const [error, setError] = useState(null)
  const [active, setActive] = useState(null)       // comment id, or 'draft'
  const [draft, setDraft] = useState(null)         // { quote, prefix, suffix } | { whole: true }
  const [pill, setPill] = useState(null)           // { x, y, anchor }
  const [positions, setPositions] = useState({})   // comment id -> top within .reader
  const [sheet, setSheet] = useState(null)         // thread id open in the phone sheet
  const [showResolved, setShowResolved] = useState(false)
  const [readState, setReadState] = useState(null)
  const readerRef = useRef(null)
  const bodyRef = useRef(null)
  const footRef = useRef(null)
  const isDesktop = useMedia('(min-width: 1040px)')

  const reloadComments = useCallback(() => loadComments(id).then(setComments).catch((e) => setError(e.message)), [id])

  useEffect(() => {
    setA(null); setComments([]); setActive(null); setDraft(null); setPill(null); setSheet(null)
    loadArticle(id).then((row) => {
      setA(row)
      const mine = row.reads.find((r) => r.profile_id === me.id)
      setReadState(mine?.read_at || null)
      upsertRead(me.id, id, {}).catch(() => {})
    }).catch((e) => setError(e.message))
    reloadComments()
    return subscribeComments(id, reloadComments)
  }, [id, me.id, reloadComments])

  // Auto mark read once the foot scrolls into view.
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
  const resolvedCount = roots.length - roots.filter((c) => !c.resolved_at).length

  // Paint highlights and measure where each thread's passage sits.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !a?.content_html) return
    clearMarks(body)
    const { text } = indexText(body)
    const found = {}
    const items = visibleRoots.filter((c) => c.quote).map((c) => ({ id: c.id, c }))
    if (draft?.quote) items.push({ id: 'draft', c: draft })
    for (const { id: cid, c } of items) {
      const pos = locate(text, c)
      if (pos < 0) continue
      const cls = [cid === active ? 'active' : '', c.resolved_at ? 'resolved' : ''].join(' ').trim()
      const marks = markRange(body, pos, pos + c.quote.length, { 'data-cid': cid, class: cls })
      if (marks[0]) found[cid] = marks[0]
    }
    const readerTop = readerRef.current.getBoundingClientRect().top
    const next = {}
    for (const [cid, mark] of Object.entries(found)) next[cid] = mark.getBoundingClientRect().top - readerTop
    setPositions(next)
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

  const startDraft = (anchor) => {
    setDraft(anchor); setActive('draft'); setPill(null)
    document.getSelection()?.removeAllRanges()
    if (!isDesktop) setSheet('draft')
  }

  const onBodyClick = (e) => {
    const mark = e.target.closest?.('mark[data-cid]')
    if (!mark) { if (!pill) setActive(null); return }
    const cid = mark.getAttribute('data-cid')
    setActive(cid)
    if (!isDesktop) setSheet(cid)
  }

  const submit = async (body, parentId = null) => {
    if (!body.trim()) return
    const row = { article_id: id, author_id: me.id, body: body.trim(), parent_id: parentId }
    if (!parentId && draft?.quote) Object.assign(row, { quote: draft.quote, prefix: draft.prefix, suffix: draft.suffix })
    const created = await addComment(row)
    setComments((cs) => [...cs, created])
    if (!parentId) { setDraft(null); setActive(created.id); if (sheet === 'draft') setSheet(created.id) }
    upsertRead(me.id, id, {}).catch(() => {})
  }
  const handlers = {
    onReply: (parentId, body) => submit(body, parentId),
    onResolve: async (cid, resolved) => { await resolveComment(cid, resolved); await reloadComments(); if (resolved) setActive(null) },
    onEdit: async (cid, body) => { await editComment(cid, body); await reloadComments() },
    onDelete: async (cid) => { await deleteComment(cid); await reloadComments(); if (active === cid) setActive(null); if (sheet === cid) setSheet(null) },
  }

  if (error) return <div className="status">{error}</div>
  if (!a) return <div className="status">Unfolding</div>

  const readers = a.reads.filter((r) => r.read_at).map((r) => byId[r.profile_id]).filter(Boolean)
  const heroInBody = a.hero_image_url && a.content_html && a.content_html.includes(a.hero_image_url.split('?')[0].slice(-40))
  const threadProps = (c) => ({ key: c.id, thread: c, replies: repliesOf[c.id] || [], byId, me, active: active === c.id, onActivate: () => setActive(c.id), ...handlers })

  return (
    <div className="reader" ref={readerRef} onClick={onBodyClick}>
      <div className="reader-col">
        <div className="reader-top">
          <a className="back" href="#/">Back to the pile</a>
          <a className="caps" href={a.url} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>Open at {a.site}</a>
        </div>

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
          <div className="art-shares">
            {a.shares.map((s) => {
              const p = byId[s.profile_id]
              return (
                <div className="share-line" key={s.id} style={{ '--who': p?.color }}>
                  <span className="avatar">{initials(p)}</span>
                  <div>
                    <div className="share-who"><b>{p?.display_name || 'Someone'}</b> sent this {agoPhrase(s.shared_at)}</div>
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
                {a.hero_caption && <figcaption>{a.hero_caption}</figcaption>}
              </figure>
            )}
            <div className="art-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: a.content_html }} />
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
          <button className="btn quiet" onClick={() => startDraft({ whole: true })}>Comment on the whole piece</button>
          {readers.length > 0 && (
            <span className="readers">
              {readers.map((p) => <span key={p.id} className="avatar sm" style={{ '--who': p.color }}>{initials(p)}</span>)}
              <span style={{ marginLeft: 8 }}>read it</span>
            </span>
          )}
        </div>

        {!isDesktop && (
          <section style={{ marginTop: 28 }}>
            <div className="rail-head" style={{ position: 'static', padding: 0, marginBottom: 12 }}>
              <span className="caps">{visibleRoots.length} {visibleRoots.length === 1 ? 'comment' : 'comments'}</span>
              {resolvedCount > 0 && <button className="resolved-toggle" onClick={() => setShowResolved((v) => !v)}>{showResolved ? 'Hide resolved' : `${resolvedCount} resolved`}</button>}
            </div>
            {visibleRoots.filter((c) => !c.quote).map((c) => <ThreadCard {...threadProps(c)} static />)}
            {visibleRoots.filter((c) => c.quote).map((c) => <ThreadCard {...threadProps(c)} static />)}
          </section>
        )}
      </div>

      {isDesktop && (
        <aside className="reader-rail">
          <div className="rail-head">
            <span className="caps">{visibleRoots.length} {visibleRoots.length === 1 ? 'comment' : 'comments'}</span>
            {resolvedCount > 0 && <button className="resolved-toggle" onClick={() => setShowResolved((v) => !v)}>{showResolved ? 'Hide resolved' : `${resolvedCount} resolved`}</button>}
          </div>
          <Rail
            threads={visibleRoots}
            repliesOf={repliesOf}
            positions={positions}
            active={active}
            draft={draft}
            byId={byId}
            me={me}
            onActivate={setActive}
            onDraftSubmit={(body) => submit(body)}
            onDraftCancel={() => { setDraft(null); setActive(null) }}
            {...handlers}
          />
        </aside>
      )}

      {pill && (
        <button className="sel-pill" style={{ left: pill.x, top: pill.y }} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); startDraft(pill.anchor) }}>
          Comment
        </button>
      )}

      {!isDesktop && sheet && (
        <>
          <div className="sheet-scrim" onClick={() => { setSheet(null); if (sheet === 'draft') { setDraft(null); setActive(null) } }} />
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="caps">{sheet === 'draft' ? 'New comment' : 'Thread'}</span>
              <button className="linklike" onClick={() => { setSheet(null); if (sheet === 'draft') { setDraft(null); setActive(null) } }}>Close</button>
            </div>
            {sheet === 'draft'
              ? <DraftCard draft={draft} onSubmit={(b) => submit(b)} onCancel={() => { setDraft(null); setActive(null); setSheet(null) }} static />
              : roots.filter((c) => c.id === sheet).map((c) => <ThreadCard {...threadProps(c)} active static />)}
          </div>
        </>
      )}
    </div>
  )
}
