import { useLayoutEffect, useRef, useState } from 'react'
import { ago } from '../components/Feed'
import { initials } from '../components/Me'

const GAP = 10

/**
 * The Docs-style rail. Each thread card wants to sit level with its passage
 * (positions[id]); cards that would overlap are pushed down, and when a card
 * is active it gets its exact spot and the others move out of its way, above
 * and below. Whole-article comments (no passage) stack at the top.
 */
export function Rail({ threads, repliesOf, positions, active, draft, byId, me, onActivate, onDraftSubmit, onDraftCancel, ...handlers }) {
  const refs = useRef({})
  const [tops, setTops] = useState({})
  const [railHeight, setRailHeight] = useState(0)

  const items = []
  for (const t of threads.filter((c) => !c.quote)) items.push({ id: t.id, want: 44, thread: t })
  if (draft?.whole) items.push({ id: 'draft', want: 44, draft })
  for (const t of threads.filter((c) => c.quote)) items.push({ id: t.id, want: positions[t.id] ?? null, thread: t })
  if (draft?.quote) items.push({ id: 'draft', want: positions.draft ?? null, draft })
  const placed = items.filter((i) => i.want != null).sort((a, b) => a.want - b.want || (a.id === 'draft' ? 1 : -1))

  useLayoutEffect(() => {
    const h = (id) => refs.current[id]?.offsetHeight || 0
    const next = {}
    const idx = placed.findIndex((i) => i.id === active)
    if (idx === -1) {
      let cursor = 0
      for (const it of placed) { next[it.id] = Math.max(it.want, cursor); cursor = next[it.id] + h(it.id) + GAP }
    } else {
      next[placed[idx].id] = placed[idx].want
      let cursor = placed[idx].want + h(placed[idx].id) + GAP
      for (const it of placed.slice(idx + 1)) { next[it.id] = Math.max(it.want, cursor); cursor = next[it.id] + h(it.id) + GAP }
      let ceiling = placed[idx].want - GAP
      for (const it of placed.slice(0, idx).reverse()) { next[it.id] = Math.max(0, Math.min(it.want, ceiling - h(it.id))); ceiling = next[it.id] - GAP }
    }
    let bottom = 0
    for (const it of placed) bottom = Math.max(bottom, (next[it.id] || 0) + h(it.id))
    const same = Object.keys(next).length === Object.keys(tops).length && Object.entries(next).every(([k, v]) => Math.abs((tops[k] ?? -1) - v) < 0.5)
    if (!same) setTops(next)
    if (Math.abs(bottom - railHeight) > 0.5) setRailHeight(bottom)
  })

  return (
    <div style={{ position: 'relative', height: railHeight + 80 }}>
      {placed.map((it) => (
        <div key={it.id} ref={(el) => { refs.current[it.id] = el }}
          className={`card ${it.id === active ? 'active' : active ? 'dim' : ''} ${it.draft ? 'draft' : ''}`}
          style={{ top: tops[it.id] ?? it.want, '--who': it.thread ? byId[it.thread.author_id]?.color : me.color }}
          onClick={(e) => { e.stopPropagation(); if (it.thread) onActivate(it.id) }}>
          {it.draft
            ? <DraftCard draft={it.draft} onSubmit={onDraftSubmit} onCancel={onDraftCancel} bare />
            : <ThreadBody thread={it.thread} replies={repliesOf[it.id] || []} byId={byId} me={me} active={it.id === active} {...handlers} />}
        </div>
      ))}
    </div>
  )
}

export function ThreadCard({ thread, replies, byId, me, active, onActivate, static: isStatic, ...handlers }) {
  return (
    <div className={`card ${isStatic ? 'static' : ''} ${active ? 'active' : ''}`} style={{ '--who': byId[thread.author_id]?.color }}
      onClick={(e) => { e.stopPropagation(); onActivate?.() }}>
      <ThreadBody thread={thread} replies={replies} byId={byId} me={me} active={active} {...handlers} />
    </div>
  )
}

function ThreadBody({ thread, replies, byId, me, active, onReply, onResolve, onEdit, onDelete }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e?.preventDefault()
    if (!reply.trim() || busy) return
    setBusy(true)
    try { await onReply(thread.id, reply); setReply('') } finally { setBusy(false) }
  }
  return (
    <div className="thread">
      {thread.quote && <div className="cmt-quote">{thread.quote}</div>}
      <Comment c={thread} byId={byId} me={me} onEdit={onEdit} onDelete={onDelete} />
      {replies.map((r) => <Comment key={r.id} c={r} byId={byId} me={me} onEdit={onEdit} onDelete={onDelete} />)}
      {active && (
        <>
          <form className="cmt-form" onSubmit={send}>
            <textarea placeholder="Reply" value={reply} onChange={(e) => setReply(e.target.value)} autoFocus={!thread.resolved_at}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(e) }} />
            <div className="actions">
              <button type="button" className="btn quiet" onClick={() => onResolve(thread.id, !thread.resolved_at)}>
                {thread.resolved_at ? 'Reopen' : 'Resolve'}
              </button>
              <button type="submit" className="btn solid" disabled={busy || !reply.trim()}>Reply</button>
            </div>
          </form>
          {thread.resolved_at && <div className="caps" style={{ marginTop: 4 }}>Resolved by {byId[thread.resolved_by]?.short_name || 'someone'}</div>}
        </>
      )}
    </div>
  )
}

function Comment({ c, byId, me, onEdit, onDelete }) {
  const p = byId[c.author_id]
  const mine = c.author_id === me.id
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.body)
  const save = async (e) => {
    e.preventDefault()
    if (text.trim() && text !== c.body) await onEdit(c.id, text.trim())
    setEditing(false)
  }
  return (
    <div className="cmt" style={{ '--who': p?.color }}>
      <span className="avatar">{initials(p)}</span>
      <div>
        <div className="cmt-head">
          <span className="cmt-who">{p?.short_name || 'Someone'}</span>
          <span className="cmt-when">{ago(c.created_at)}{c.edited_at ? ', edited' : ''}</span>
        </div>
        {editing ? (
          <form className="cmt-form" onSubmit={save}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <div className="actions">
              <button type="button" className="btn quiet" onClick={() => { setEditing(false); setText(c.body) }}>Cancel</button>
              <button type="submit" className="btn solid">Save</button>
            </div>
          </form>
        ) : (
          <>
            <p className="cmt-body">{c.body}</p>
            {mine && (
              <div className="cmt-actions">
                <button className="linklike" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>Edit</button>
                <button className="linklike danger" onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this comment?')) onDelete(c.id) }}>Delete</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function DraftCard({ draft, onSubmit, onCancel, bare, static: isStatic }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    try { await onSubmit(text) } finally { setBusy(false) }
  }
  const inner = (
    <div className="thread">
      {draft?.quote && <div className="cmt-quote">{draft.quote}</div>}
      {draft?.whole && <div className="caps">On the whole piece</div>}
      <form className="cmt-form" onSubmit={send} onClick={(e) => e.stopPropagation()}>
        <textarea placeholder="Say the thing" value={text} onChange={(e) => setText(e.target.value)} autoFocus
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(e); if (e.key === 'Escape') onCancel() }} />
        <div className="actions">
          <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn solid" disabled={busy || !text.trim()}>Comment</button>
        </div>
      </form>
    </div>
  )
  if (bare) return inner
  return <div className={`card draft ${isStatic ? 'static' : ''}`} onClick={(e) => e.stopPropagation()}>{inner}</div>
}
