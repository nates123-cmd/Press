/* The page a share link lands on: #/s/<token>. Anyone reads, no sign-in, no
 * names, no comment text. "Comment" moves to #/a/<id>, which the gate guards:
 * pick your face, enter the code, and the full reader opens on this article.
 * A member already signed in skips this page and goes straight there.
 * Everything it shows comes from press_public_article(). */
import { useEffect, useState } from 'react'
import { loadPublicArticle } from '../lib/press'
import { supabase } from '../lib/supabase'

const Bubble = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 4.5h14v9H8l-4 3v-3H3z" strokeLinejoin="round" />
  </svg>
)

export function Shared({ token }) {
  const [a, setA] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    setA(undefined)
    Promise.all([loadPublicArticle(token), supabase.auth.getSession()]).then(([row, { data }]) => {
      if (row && data.session) { window.location.replace(`#/a/${row.id}`); return }
      setA(row)
    }).catch((e) => setError(e.message))
  }, [token])

  const comment = () => { window.location.hash = `#/a/${a.id}` }

  useEffect(() => { if (a?.title) document.title = a.title }, [a])

  if (error) return <div className="status">Could not open this link: {error}</div>
  if (a === undefined) return <div className="status">Unfolding</div>
  if (!a) return <div className="status">This link does not open anything. Ask whoever sent it for a new one.</div>

  const heroInBody = a.hero_image_url && a.content_html && a.content_html.includes(a.hero_image_url.split('?')[0].slice(-40))
  const ready = a.status === 'ready' && a.content_html
  const commentButton = (
    <button className="comments-btn" onClick={comment} title="Sign in as yourself to read and add comments">
      <Bubble /> {a.comment_count > 0 ? `Comments ${a.comment_count}` : 'Comment'}
    </button>
  )

  return (
    <div className="reader shared">
      <div className="reader-top">
        <span className="shared-mark">Press Gang</span>
        <div className="tools">
          <a className="caps shared-source" href={a.url} target="_blank" rel="noopener">Open at {a.site}</a>
          {commentButton}
        </div>
      </div>

      <div className="art-col">
        <header className="art-head">
          <div className="art-kicker">
            <span className="caps">{a.site}</span>
            {a.published_at && <span className="caps">{new Date(a.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>}
          </div>
          <h1 className="art-title">{a.title || a.url}</h1>
          {a.dek && <p className="art-dek">{a.dek}</p>}
          {(a.byline || a.word_count) && (
            <div className="art-byline">
              {a.byline && <span>By <b>{a.byline}</b></span>}
              {a.word_count ? <><span className="sep" /><span>{Math.max(1, Math.round(a.word_count / 240))} min read</span></> : null}
            </div>
          )}
          <hr className="rule" />
        </header>

        {ready ? (
          <>
            {a.hero_image_url && !heroInBody && (
              <figure className="art-hero">
                <img src={a.hero_image_url} alt="" />
                {a.hero_caption && <figcaption>{a.hero_caption.replace(/^Credit\.{3}\s*/, 'Credit: ')}</figcaption>}
              </figure>
            )}
            <div className="art-body" dangerouslySetInnerHTML={{ __html: a.content_html.replace(/Credit\.{3}\s*/g, 'Credit: ') }} />
          </>
        ) : (
          <div className="link-only">
            {a.hero_image_url && <img src={a.hero_image_url} alt="" />}
            <a href={a.url} target="_blank" rel="noopener">Read it at {a.site}</a>
          </div>
        )}

        <div className="art-foot">
          {commentButton}
          <a className="btn quiet" href={a.url} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>Open at {a.site}</a>
          <span className="readers">Shared from Press Gang</span>
        </div>
      </div>
    </div>
  )
}
