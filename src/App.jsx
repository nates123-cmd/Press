import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AuthGate, signOut } from './auth/AuthGate'
import { loadProfiles, myProfileId } from './lib/press'
import { Feed } from './components/Feed'
import { Me } from './components/Me'
import { Reader } from './reader/Reader'

export const PressContext = createContext(null)
export const usePress = () => useContext(PressContext)

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const m = hash.match(/^#\/a\/([0-9a-f-]{36})/)
  if (m) return { page: 'article', id: m[1] }
  if (hash.startsWith('#/me')) return { page: 'me' }
  return { page: 'feed' }
}

export const go = (to) => { window.location.hash = to }

function Shell() {
  const [profiles, setProfiles] = useState(null)
  const [meId, setMeId] = useState(null)
  const [error, setError] = useState(null)
  const route = useHashRoute()

  const refresh = useCallback(async () => {
    try {
      const [ps, id] = await Promise.all([loadProfiles(), myProfileId()])
      setProfiles(ps); setMeId(id)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const ctx = useMemo(() => {
    if (!profiles) return null
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]))
    return { profiles, byId, me: byId[meId] || null, refresh }
  }, [profiles, meId, refresh])

  if (error) return <div className="status">Could not load Press: {error}</div>
  if (!ctx) return <div className="status">Opening the paper</div>
  if (!ctx.me) {
    return (
      <div className="auth-shell"><div className="auth-col">
        <h1>Press<span className="dot">.</span></h1>
        <p className="auth-sub">You are signed in, but this address is not on the Press Gang list yet. Ask Nate to add it.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div></div>
    )
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <PressContext.Provider value={ctx}>
      {route.page !== 'article' && (
        <header className="masthead">
          <div className="masthead-row">
            <h1><a href="#/" style={{ textDecoration: 'none' }}>Press<span className="dot">.</span></a></h1>
            <nav className="masthead-meta">
              <span className="caps">{today}</span>
              <a className="caps" href="#/me" style={{ textDecoration: 'none' }}>{ctx.me.short_name}</a>
              <button className="caps" onClick={signOut}>Sign out</button>
            </nav>
          </div>
          <hr className="rule" />
        </header>
      )}
      {route.page === 'feed' && <Feed />}
      {route.page === 'me' && <Me />}
      {route.page === 'article' && <Reader id={route.id} />}
    </PressContext.Provider>
  )
}

export default function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  )
}
