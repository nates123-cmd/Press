import { useEffect, useRef, useState } from 'react'
import { ago } from '../components/Feed'
import { initials } from '../components/Me'

/**
 * The comment panel, the way the Times does it: slides in from the right over
 * the page, composer on top, threads under it newest first. Press adds the
 * passage: a thread anchored to text shows its quote, clicking the quote
 * jumps to the highlight, clicking a highlight opens the panel on the thread.
 */
export function Panel({
  open, onClose, roots, repliesOf, byId, me, active, onActivate, onJump,
  draft, onDraftCancel, onSubmit, onReply, onResolve, onEdit, onDelete,
  showResolved, setShowResolved, resolvedCount,
}) {
  const bodyRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Scroll the active thread into view when the panel opens on it.
  useEffect(() => {
    if (!open || !active || !bodyRef.current) return
    const el = bodyRef.current.querySelector(`[data-thread="${active}"]`)
    if (el) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260)
  }, [open, active])

  const live = roots.filter((c) => !c.resolved_at).length
  const list = [...roots].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return (
    <>
      <div className={`panel-scrim ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`panel ${open ? 'open' : ''}`} aria-hidden={!open} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="panel-title">Comments<span className="count">{live}</span></span>
          <button className="panel-close" onClick={onClose} aria-label="Close comments">&times;</button>
        </div>
        <div className="panel-body" ref={bodyRef}>
          <Composer key={draft ? draft.quote || 'whole' : 'idle'} draft={draft} onSubmit={onSubmit} onCancel={onDraftCancel} open={open} />

          <div className="panel-tools">
            <span className="caps">{live === 0 ? 'No comments yet' : `${live} ${live === 1 ? 'comment' : 'comments'}`}</span>
            {resolvedCount > 0 && (
              <button className="resolved-toggle" onClick={() => setShowResolved((v) => !v)}>
                {showResolved ? 'Hide resolved' : `Show ${resolvedCount} resolved`}
              </button>
            )}
          </div>

          {list.length === 0 && <div className="panel-empty">Be the first. Select a passage in the piece, or write about the whole thing above.</div>}

          {list.map((c) => (
            <Thread key={c.id} thread={c} replies={repliesOf[c.id] || []} byId={byId} me={me}
              active={active === c.id} onActivate={() => onActivate(c.id)} onJump={() => onJump(c.id)}
              onReply={onReply} onResolve={onResolve} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </aside>
    </>
  )
}

function Composer({ draft, onSubmit, onCancel, open }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(!!draft)
  const ref = useRef(null)
  useEffect(() => { if (draft && open) setTimeout(() => ref.current?.focus(), 280) }, [draft, open])
  const send = async (e) => {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    try { await onSubmit(text); setText(''); setArmed(false) } finally { setBusy(false) }
  }
  return (
    <form className={`composer ${armed || draft ? 'armed' : ''}`} onSubmit={send}>
      {draft?.quote && <div className="quote">{draft.quote}</div>}
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setArmed(true)}
        placeholder={draft?.quote ? 'What about this passage?' : 'Share your thoughts on the whole piece'}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(e); if (e.key === 'Escape' && draft) onCancel() }} />
      {(armed || draft) && (
        <div className="actions">
          <button type="button" className="btn quiet" onClick={() => { setText(''); setArmed(false); if (draft) onCancel() }}>Cancel</button>
          <button type="submit" className="btn solid" disabled={busy || !text.trim()}>Submit</button>
        </div>
      )}
      {!draft && !armed && <div className="hint">Select text in the piece to comment on a passage.</div>}
    </form>
  )
}

function Thread({ thread, replies, byId, me, active, onActivate, onJump, onReply, onResolve, onEdit, onDelete }) {
  const [replying, setReplying] = useState(false)
  const [showReplies, setShowReplies] = useState(active || replies.length <= 2)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (active) setShowReplies(true) }, [active])
  const send = async (e) => {
    e?.preventDefault()
    if (!reply.trim() || busy) return
    setBusy(true)
    try { await onReply(thread.id, reply); setReply(''); setReplying(false); setShowReplies(true) } finally { setBusy(false) }
  }
  const author = byId[thread.author_id]
  return (
    <div className={`thread ${active ? 'active' : ''} ${thread.resolved_at ? 'resolved' : ''}`} data-thread={thread.id}
      style={{ '--who': author?.color }} onClick={onActivate}>
      {thread.quote && <div className="quote" onClick={(e) => { e.stopPropagation(); onActivate(); onJump() }} title="Jump to the passage">{thread.quote}</div>}
      <Comment c={thread} byId={byId} me={me} onEdit={onEdit} onDelete={onDelete}
        extra={(
          <>
            <button className="linklike" onClick={(e) => { e.stopPropagation(); setReplying((v) => !v) }}>Reply</button>
            <button className="linklike muted" onClick={(e) => { e.stopPropagation(); onResolve(thread.id, !thread.resolved_at) }}>
              {thread.resolved_at ? 'Reopen' : 'Resolve'}
            </button>
          </>
        )} />
      {thread.resolved_at && <div className="resolved-by">Resolved by {byId[thread.resolved_by]?.short_name || 'someone'}</div>}

      {replies.length > 0 && !showReplies && (
        <button className="replies-toggle" onClick={(e) => { e.stopPropagation(); setShowReplies(true) }}>
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </button>
      )}
      {replies.length > 0 && showReplies && (
        <div className="replies">
          {replies.map((r) => <Comment key={r.id} c={r} byId={byId} me={me} onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      )}
      {replying && (
        <form className="reply-form" onSubmit={send} onClick={(e) => e.stopPropagation()}>
          <textarea autoFocus placeholder={`Reply to ${author?.short_name || 'this'}`} value={reply} onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(e); if (e.key === 'Escape') setReplying(false) }} />
          <div className="actions">
            <button type="button" className="btn quiet" onClick={() => setReplying(false)}>Cancel</button>
            <button type="submit" className="btn solid" disabled={busy || !reply.trim()}>Reply</button>
          </div>
        </form>
      )}
    </div>
  )
}

function Comment({ c, byId, me, onEdit, onDelete, extra }) {
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
          <span className="cmt-who">{p?.display_name || p?.short_name || 'Someone'}</span>
          <span className="cmt-when">{ago(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
        </div>
        {editing ? (
          <form className="edit-form" onSubmit={save} onClick={(e) => e.stopPropagation()}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <div className="actions">
              <button type="button" className="btn quiet" onClick={() => { setEditing(false); setText(c.body) }}>Cancel</button>
              <button type="submit" className="btn solid">Save</button>
            </div>
          </form>
        ) : (
          <>
            <p className="cmt-body">{c.body}</p>
            <div className="cmt-actions">
              {extra}
              {mine && <button className="linklike muted" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>Edit</button>}
              {mine && <button className="linklike muted danger" onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this comment?')) onDelete(c.id) }}>Delete</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
