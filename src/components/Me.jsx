import { useState } from 'react'
import { usePress } from '../App'
import { updateMe } from '../lib/press'

const INKS = ['#1F4E79', '#B5481A', '#3E6B35', '#7A3E8C', '#9A6B00', '#0B6E6E', '#8C2E4A', '#444444']

export function Me() {
  const { me, profiles, refresh } = usePress()
  const [displayName, setDisplayName] = useState(me.display_name)
  const [shortName, setShortName] = useState(me.short_name)
  const [color, setColor] = useState(me.color)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      await updateMe(me.id, { display_name: displayName.trim(), short_name: shortName.trim(), color })
      await refresh(); setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (err) { setError(err.message) }
  }

  return (
    <main className="feed">
      <form className="me-form" onSubmit={save}>
        <span className="caps">You</span>
        <label>Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></label>
        <label>Short name, what the margin shows<input value={shortName} onChange={(e) => setShortName(e.target.value.slice(0, 12))} required /></label>
        <label>Your ink
          <div className="swatches">
            {INKS.map((c) => <button type="button" key={c} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
          </div>
        </label>
        <div><button className="btn solid" type="submit">{saved ? 'Saved' : 'Save'}</button></div>
        {error && <div className="err">{error}</div>}
      </form>
      <hr className="rule" />
      <div className="people">
        <span className="caps" style={{ marginTop: 18 }}>The Press Gang</span>
        {profiles.map((p) => (
          <div className="person" key={p.id}>
            <span className="avatar" style={{ '--who': p.color }}>{initials(p)}</span>
            <span>{p.display_name}{p.id === me.id ? ' (you)' : ''}</span>
            <span className="muted">{p.user_id ? 'signed in' : 'not signed in yet'}</span>
          </div>
        ))}
      </div>
    </main>
  )
}

export function initials(p) {
  if (!p) return '?'
  const s = (p.short_name || p.display_name || '?').trim()
  return /^\d+$/.test(s) ? s.slice(-2) : s.slice(0, 1).toUpperCase()
}
