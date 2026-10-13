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

/* Day and night by the clock, not the OS: white from 7 AM to 7 PM, black
 * otherwise, checked every minute. A manual pick in the masthead sticks for
 * the rest of the day and then the clock takes over again. */
const DAY_START = 7, DAY_END = 19
const clockTheme = () => { const h = new Date().getHours(); return h >= DAY_START && h < DAY_END ? 'light' : 'dark' }
function readOverride() {
  try {
    const raw = localStorage.getItem('press-theme-override')
    if (!raw) return null
    const { theme, day } = JSON.parse(raw)
    return day === new Date().toDateString() ? theme : null
  } catch { return null }
}
function useDayNight() {
  const [override, setOverride] = useState(readOverride)
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t) }, [])
  const theme = override || clockTheme()
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme, tick])
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    const sameAsClock = next === clockTheme()
    try {
      if (sameAsClock) localStorage.removeItem('press-theme-override')
      else localStorage.setItem('press-theme-override', JSON.stringify({ theme: next, day: new Date().toDateString() }))
    } catch {}
    setOverride(sameAsClock ? null : next)
  }
  return { theme, toggle }
}

function Shell() {
  const [profiles, setProfiles] = useState(null)
  const [meId, setMeId] = useState(null)
  const [error, setError] = useState(null)
  const route = useHashRoute()
  const { theme, toggleTheme } = useContext(ThemeContext)

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
        <h1>Press Gang</h1>
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
            <span className="caps masthead-left">{today}</span>
            <h1><a href="#/">Press Gang</a></h1>
            <nav className="masthead-right">
              <button className="caps" onClick={toggleTheme} title="Day from 7 AM, night from 7 PM. Click to override until tomorrow.">{theme === 'light' ? 'Night' : 'Day'}</button>
              <a className="caps" href="#/me" style={{ textDecoration: 'none' }}>{ctx.me.short_name}</a>
              <button className="caps" onClick={signOut}>Sign out</button>
            </nav>
          </div>
          <hr className="rule double" />
        </header>
      )}
      {route.page === 'feed' && <Feed />}
      {route.page === 'me' && <Me />}
      {route.page === 'article' && <Reader id={route.id} />}
    </PressContext.Provider>
  )
}

const ThemeContext = createContext({ theme: 'light', toggleTheme: () => {} })

export default function App() {
  // The clock theme wraps the gate too, so the sign-in screen is white by day.
  const { theme, toggle } = useDayNight()
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: toggle }}>
      <AuthGate>
        <Shell />
      </AuthGate>
    </ThemeContext.Provider>
  )
}
