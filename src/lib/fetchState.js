/* What the feed says under a link that is not ready yet.
 *
 * Two readers do the fetching. The Beelink reads everything except the
 * walled sites (NYT, WSJ) every 60 s; Nate's Mac reads the walled ones every
 * 120 s with a signed-in Chrome, and only while it is awake. Each writes a
 * heartbeat to press_workers every pass and stamps articles.claimed_at when
 * it starts on a row. From those three facts the feed can say which of
 * "in queue", "reading now", "retrying", "reader asleep" or "gave up" is true,
 * instead of a bare "fetching" that looks the same whether it works or not. */

export const WALLED = ['nytimes.com', 'wsj.com']
export const MAX_ATTEMPTS = 5

const BEELINK_STALE = 4 * 60 * 1000  // a 60 s loop that has not reported in 4 min is down
const MAC_STALE = 6 * 60 * 1000      // a 120 s launchd job silent for 6 min means the lid is shut
const CLAIM_FRESH = 90 * 1000        // a claim older than this is a render that died

export function readerFor(site) {
  return WALLED.some((w) => site === w || site.endsWith('.' + w)) ? 'mac' : 'beelink'
}

/* A fetch error in plain words. The raw text stays in the database. */
export function plainError(err) {
  const e = String(err || '')
  if (!e) return 'no reason recorded'
  if (/bot wall|blocked|captcha/i.test(e)) return 'the site blocked the reader'
  if (/paywall/i.test(e)) return 'the paywall hid the story'
  if (/timeout|timed out/i.test(e)) return 'the page took too long to load'
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(e)) return 'that site does not exist'
  if (/ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET|ECONN|ETIMEDOUT|ERR_SSL|ERR_CERT/.test(e)) return 'the site could not be reached'
  if (/nothing parsed|no articleBody|readability/i.test(e)) return 'no article found on the page'
  if (/-> 4\d\d|-> 5\d\d/.test(e)) return 'the database refused the write'
  if (/Target closed|crashed|browser has been closed/i.test(e)) return 'the reader crashed on it'
  return e.length > 70 ? e.slice(0, 67) + '...' : e
}

export function elapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/**
 * @param a        feed row: status, site, attempts, fetch_error, claimed_at, created_at
 * @param workers  { beelink?: {last_seen_at, last_ok_at, note}, mac?: {...} }
 * @param now      Date.now()
 * @returns null when the row is ready, else { text, tone: 'wait' | 'bad', retry: boolean }
 */
export function fetchState(a, workers, now = Date.now()) {
  if (a.status === 'failed') {
    return { tone: 'bad', retry: true, text: `gave up after ${a.attempts || MAX_ATTEMPTS} tries: ${plainError(a.fetch_error)}. Opens the source` }
  }
  if (a.status !== 'pending') return null

  const reader = readerFor(a.site)
  const w = workers?.[reader]
  const seen = w ? new Date(w.last_seen_at).getTime() : 0
  // workers === null means the heartbeat table could not be read at all; say nothing about it then.
  const stale = workers ? (!w || now - seen > (reader === 'mac' ? MAC_STALE : BEELINK_STALE)) : false
  const claimed = a.claimed_at ? new Date(a.claimed_at).getTime() : 0
  const since = now - new Date(a.queued_at || a.created_at).getTime()
  const attempts = a.attempts || 0

  if (claimed && now - claimed < CLAIM_FRESH) return { tone: 'wait', retry: false, text: 'reading it now' }

  if (stale) {
    const quiet = w ? `quiet for ${elapsed(now - seen)}` : 'has never reported in'
    return reader === 'mac'
      ? { tone: 'bad', retry: false, text: `waits for Nate's Mac to wake (${quiet}); NYT and WSJ only read from there` }
      : { tone: 'bad', retry: false, text: `the fetcher is down (${quiet})` }
  }

  if (reader === 'mac' && w?.note === 'no chrome profile') return { tone: 'bad', retry: false, text: 'the NYT reader is signed out; Nate has to log it in again' }
  if (reader === 'mac' && w?.note === 'bot wall') return { tone: 'bad', retry: false, text: 'NYT bot wall hit; the reader backs off and tries again every 2 min' }

  if (attempts > 0) {
    return {
      tone: 'bad', retry: attempts >= 2,
      text: `try ${attempts} of ${MAX_ATTEMPTS} failed: ${plainError(a.fetch_error)}. Next try within ${reader === 'mac' ? '2' : '1'} min`,
    }
  }

  const usual = reader === 'mac' ? 'about 3 min' : 'about 2 min'
  if (since > 10 * 60 * 1000) return { tone: 'bad', retry: true, text: `in queue for ${elapsed(since)}, longer than usual` }
  return { tone: 'wait', retry: false, text: `in queue ${elapsed(since)}, usually ready in ${usual}` }
}
