/* The page a friend outside the group lands on: #/s/<token>. No sign-in, no
 * comments, no names. The article as the reader shows it, and a way to the
 * source. Everything it shows comes from press_public_article(). */
import { useEffect, useState } from 'react'
import { loadPublicArticle } from '../lib/press'

export function Shared({ token }) {
  const [a, setA] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    setA(undefined)
    loadPublicArticle(token).then(setA).catch((e) => setError(e.message))
  }, [token])

  useEffect(() => { if (a?.title) document.title = a.title }, [a])

  if (error) return <div className="status">Could not open this link: {error}</div>
  if (a === undefined) return <div className="status">Unfolding</div>
  if (!a) return <div className="status">This link does not open anything. Ask whoever sent it for a new one.</div>

  const heroInBody = a.hero_image_url && a.content_html && a.content_html.includes(a.hero_image_url.split('?')[0].slice(-40))
  const ready = a.status === 'ready' && a.content_html

  return (
    <div className="reader shared">
      <div className="reader-top">
        <span className="shared-mark">Press Gang</span>
        <div className="tools">
          <a className="caps shared-source" href={a.url} target="_blank" rel="noopener">Open at {a.site}</a>
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
          <a className="btn quiet" href={a.url} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>Open at {a.site}</a>
          <span className="readers">Shared from Press Gang</span>
        </div>
      </div>
    </div>
  )
}
