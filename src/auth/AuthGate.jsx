/**
 * Email one-time-code sign in. Press is invite only: codes go out with
 * shouldCreateUser: false, so an address that scripts/invite.mjs never created
 * gets a polite refusal and no email. The DB trigger refuses strangers too.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STATES = { loading: 'loading', prompt: 'prompt', code: 'code', ready: 'ready' }

export function AuthGate({ children }) {
  const [state, setState] = useState(STATES.loading)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => mounted && setState(data.session ? STATES.ready : STATES.prompt))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => mounted && setState(session ? STATES.ready : STATES.prompt))
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  const sendCode = async (e) => {
    e.preventDefault()
    if (!email || busy) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } })
    setBusy(false)
    if (error) {
      setError(/not allowed|signups|not found/i.test(error.message) ? 'That address is not on the list. Ask Nate.' : error.message)
      return
    }
    setCode(''); setState(STATES.code)
  }

  const verifyCode = async (e) => {
    e.preventDefault()
    if (code.length < 6 || busy) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' })
    setBusy(false)
    if (error) setError(error.message)
  }

  if (state === STATES.loading) return <div className="auth-shell" />
  if (state === STATES.ready) return children

  return (
    <div className="auth-shell">
      <div className="auth-col">
        <h1>Press<span className="dot">.</span></h1>
        <p className="auth-sub">Everything the Press Gang has sent, in one place, with a margin to argue in.</p>

        {state === STATES.prompt && (
          <form onSubmit={sendCode} className="auth-form">
            <label className="caps" htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="email" autoFocus required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn solid" type="submit" disabled={busy || !email}>
              {busy ? 'Sending' : 'Email me a code'}
            </button>
            {error && <div className="err">{error}</div>}
            <div className="auth-note">Invite only. The code can take a minute.</div>
          </form>
        )}

        {state === STATES.code && (
          <form onSubmit={verifyCode} className="auth-form">
            <label className="caps" htmlFor="auth-code">Code</label>
            <input id="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="12345678" maxLength={8} />
            <button className="btn solid" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Checking' : 'Sign in'}
            </button>
            {error && <div className="err">{error}</div>}
            <div className="auth-note">Sent to {email}.</div>
            <button type="button" className="linklike" onClick={() => { setError(null); setCode(''); setState(STATES.prompt) }}>
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export async function signOut() {
  await supabase.auth.signOut()
}
