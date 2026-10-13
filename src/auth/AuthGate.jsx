/**
 * Sign in, personalised. The four faces first; tap yours, confirm the
 * address it is tied to, then the 8-digit code under your own headshot.
 * Invite only: codes go out with shouldCreateUser: false, and the lookup
 * refuses an address that is not on the list. "Someone else" is the plain
 * email path for a member whose face is not up yet.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Avatar } from '../components/Me'

const STATES = { loading: 'loading', pick: 'pick', email: 'email', code: 'code', ready: 'ready' }

export function AuthGate({ children }) {
  const [state, setState] = useState(STATES.loading)
  const [members, setMembers] = useState([])
  const [who, setWho] = useState(null)          // the member picked, or null for "someone else"
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => mounted && setState(data.session ? STATES.ready : STATES.pick))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => mounted && setState(session ? STATES.ready : STATES.pick))
    supabase.rpc('press_members').then(({ data }) => mounted && setMembers(data || []))
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  const pick = (m) => { setWho(m); setEmail(''); setError(null); setState(STATES.email) }

  const sendCode = async (e) => {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!addr || busy) return
    setBusy(true); setError(null)
    const { data: found } = await supabase.rpc('press_lookup', { p_email: addr })
    const match = found?.[0]
    if (!match) { setBusy(false); setError('That address is not on the list. Ask Nate.'); return }
    if (who && match.id !== who.id) { setBusy(false); setError(`That is not ${who.short_name}'s address.`); return }
    if (!who) setWho(match)
    const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: false } })
    setBusy(false)
    if (error) { setError(error.message); return }
    setCode(''); setState(STATES.code)
  }

  const verifyCode = async (e) => {
    e.preventDefault()
    if (code.length < 6 || busy) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' })
    setBusy(false)
    if (error) setError(/expired|invalid/i.test(error.message) ? 'That code did not work. Codes last an hour and work once.' : error.message)
  }

  const back = () => { setError(null); setCode(''); setState(who ? STATES.email : STATES.pick) }

  if (state === STATES.loading) return <div className="auth-shell" />
  if (state === STATES.ready) return children

  return (
    <div className="auth-shell">
      <div className="auth-col">
        <h1>Press Gang</h1>

        {state === STATES.pick && (
          <>
            <p className="auth-sub">Who is reading?</p>
            <div className="faces">
              {members.map((m) => (
                <button key={m.id} className="face" onClick={() => pick(m)}>
                  <Avatar p={m} size="xl" />
                  <span>{m.short_name}</span>
                </button>
              ))}
            </div>
            <button className="linklike muted" onClick={() => pick(null)}>Someone else</button>
          </>
        )}

        {state === STATES.email && (
          <form onSubmit={sendCode} className="auth-form">
            {who && (
              <div className="auth-who">
                <Avatar p={who} size="xl" />
                <div>
                  <div className="auth-name">{who.display_name}</div>
                  <div className="auth-note">Confirm your email and a code is on its way.</div>
                </div>
              </div>
            )}
            {!who && <p className="auth-sub" style={{ textAlign: 'left' }}>Enter the email Nate invited.</p>}
            <label className="caps" htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="email" autoFocus required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn solid" type="submit" disabled={busy || !email}>
              {busy ? 'Sending' : 'Email me a code'}
            </button>
            {error && <div className="err">{error}</div>}
            <button type="button" className="linklike muted" onClick={() => { setWho(null); setError(null); setState(STATES.pick) }}>Not you? Pick again</button>
          </form>
        )}

        {state === STATES.code && (
          <form onSubmit={verifyCode} className="auth-form">
            {who && (
              <div className="auth-who">
                <Avatar p={who} size="xl" />
                <div>
                  <div className="auth-name">Hi, {who.short_name}.</div>
                  <div className="auth-note">The code went to {email}.</div>
                </div>
              </div>
            )}
            <label className="caps" htmlFor="auth-code">Code</label>
            <input id="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="12345678" maxLength={8} />
            <button className="btn solid" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Checking' : 'Sign in'}
            </button>
            {error && <div className="err">{error}</div>}
            <button type="button" className="linklike muted" onClick={back}>Use a different email</button>
          </form>
        )}
      </div>
    </div>
  )
}

export async function signOut() {
  await supabase.auth.signOut()
}
