/**
 * Press fetcher: the Beelink half of the pipeline.
 *
 * Polls `articles` for status = pending, renders each link in Chromium with
 * the NYT session from state/nyt-state.json (exported once on the Mac with
 * scripts/nyt-login.mjs), extracts a clean article (extract.mjs runs in-page),
 * and writes it back as status = ready. Hosts that are never articles
 * (YouTube, Spotify, X, ...) get a title and a thumbnail and status = link_only.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, optional NYT_STATE (path),
 *      POLL_SECONDS (default 60), MAX_ATTEMPTS (default 5).
 *
 * Modes:
 *   node fetch.mjs              loop forever (the container's command)
 *   node fetch.mjs --once       one pass over the queue, then exit
 *   node fetch.mjs --url <u>    render one url, print the result, write nothing
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pageExtract, pageCard } from './extract.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const READABILITY = path.join(here, 'node_modules/@mozilla/readability/Readability.js')
const ENV = process.env
const NYT_STATE = ENV.NYT_STATE || path.join(here, 'state/nyt-state.json')
const POLL = Number(ENV.POLL_SECONDS || 60) * 1000
const MAX_ATTEMPTS = Number(ENV.MAX_ATTEMPTS || 5)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'

const LINK_HOSTS = new Set([
  'youtube.com', 'youtu.be', 'open.spotify.com', 'x.com', 'twitter.com', 'instagram.com',
  'tiktok.com', 'podcasts.apple.com', 'music.apple.com', 'reddit.com', 'imgur.com',
  'tenor.com', 'giphy.com', 'apps.apple.com', 'maps.app.goo.gl', 'maps.google.com',
])
const OEMBED = {
  'youtube.com': (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  'youtu.be': (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  'open.spotify.com': (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`,
  'x.com': (u) => `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(u)}`,
  'twitter.com': (u) => `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(u)}`,
  'tiktok.com': (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  'reddit.com': (u) => `https://www.reddit.com/oembed?url=${encodeURIComponent(u)}`,
}

const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a)

// ------------------------------------------------------------------ supabase
async function sb(method, p, body, prefer) {
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing')
  const res = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${p}`, {
    method,
    headers: {
      apikey: ENV.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${ENV.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=minimal',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${(await res.text()).slice(0, 300)}`)
  const txt = await res.text()
  return txt ? JSON.parse(txt) : null
}

// ------------------------------------------------------------------ browser
let browser
async function getBrowser() {
  if (browser && browser.isConnected()) return browser
  browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] })
  return browser
}

async function newContext(host) {
  const b = await getBrowser()
  const opts = { userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' }
  if (host === 'nytimes.com' && fs.existsSync(NYT_STATE)) opts.storageState = NYT_STATE
  const ctx = await b.newContext(opts)
  // Text is all we keep. Images stay as URLs, so the bytes never need to load.
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (t === 'image' || t === 'media' || t === 'font') return route.abort()
    return route.continue()
  })
  return ctx
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').replace(/^m\./, '') } catch { return '' } }

// ------------------------------------------------------------------ extraction
async function renderArticle(url) {
  const host = hostOf(url)
  const ctx = await newContext(host)
  try {
    const page = await ctx.newPage()
    page.setDefaultTimeout(30000)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    if (host === 'nytimes.com') {
      await page.waitForSelector('section[name="articleBody"], #gateway-content, [data-testid="gateway-container"]', { timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(1200)
    } else {
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    }
    await page.addScriptTag({ path: READABILITY })
    const r = await page.evaluate(pageExtract, { host })
    r.finalUrl = page.url()
    return r
  } finally {
    await ctx.close()
  }
}

async function renderCard(url) {
  // Short links (reddit.com/r/x/s/abc, youtu.be) redirect; oEmbed wants the real url.
  if (/reddit\.com\/r\/[^/]+\/s\//.test(url)) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
      if (res.url) url = res.url.split('?')[0]
    } catch {}
  }
  const host = hostOf(url)
  const oembed = OEMBED[host]
  if (oembed) {
    try {
      const res = await fetch(oembed(url), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const j = await res.json()
        const text = j.html ? j.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
        return {
          title: j.title || (j.author_name ? `${j.author_name} on ${j.provider_name || host}` : ''),
          byline: j.author_name || j.provider_name || host,
          dek: text && !j.title ? text.slice(0, 400) : '',
          heroImage: j.thumbnail_url || null, publishedAt: null, heroCaption: '',
          html: '', text: '', wordCount: 0, method: 'oembed',
        }
      }
    } catch (e) { log('oembed failed', host, e.message) }
  }
  const ctx = await newContext(host)
  try {
    const page = await ctx.newPage()
    page.setDefaultTimeout(20000)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    return await page.evaluate(pageCard)
  } finally {
    await ctx.close()
  }
}

// ------------------------------------------------------------------ queue
async function processOne(a) {
  const attempts = (a.attempts || 0) + 1
  const started = Date.now()
  try {
    const r = a.kind === 'link' ? await renderCard(a.url) : await renderArticle(a.url)
    if (r.error) throw new Error(r.error)
    const isArticle = a.kind === 'article' && r.wordCount >= 120
    const patch = {
      status: isArticle ? 'ready' : 'link_only',
      kind: isArticle ? 'article' : 'link',
      title: (r.title || '').slice(0, 500) || null,
      byline: (r.byline || '').slice(0, 300) || null,
      dek: (r.dek || '').slice(0, 1000) || null,
      published_at: r.publishedAt && !Number.isNaN(Date.parse(r.publishedAt)) ? new Date(r.publishedAt).toISOString() : null,
      hero_image_url: r.heroImage || null,
      hero_caption: (r.heroCaption || '').slice(0, 1000) || null,
      content_html: isArticle ? r.html : null,
      content_text: isArticle ? r.text : null,
      word_count: isArticle ? r.wordCount : null,
      attempts, fetch_error: null, fetched_at: new Date().toISOString(),
    }
    await sb('PATCH', `articles?id=eq.${a.id}`, patch)
    log(patch.status, a.site, `${r.wordCount}w`, r.method, `${Date.now() - started}ms`, (patch.title || '').slice(0, 60))
  } catch (e) {
    const failed = attempts >= MAX_ATTEMPTS
    await sb('PATCH', `articles?id=eq.${a.id}`, { attempts, fetch_error: String(e.message).slice(0, 500), status: failed ? 'failed' : 'pending' })
    log(failed ? 'FAILED' : 'retry', a.site, a.url.slice(0, 80), '->', e.message.slice(0, 120))
  }
}

async function pass() {
  // Without an NYT session every NYT fetch is a guaranteed paywall: leave
  // those rows pending and untouched until scripts/nyt-login.mjs has run.
  const nytOk = fs.existsSync(NYT_STATE)
  const skip = nytOk ? '' : '&site=neq.nytimes.com'
  const rows = await sb('GET', `articles?select=id,url,site,kind,attempts&status=eq.pending&attempts=lt.${MAX_ATTEMPTS}${skip}&order=created_at.asc&limit=6`, undefined, 'return=representation')
  for (const a of rows || []) await processOne(a)
  return (rows || []).length
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === '--url') {
    const url = argv[1]
    const host = hostOf(url)
    const r = LINK_HOSTS.has(host) ? await renderCard(url) : await renderArticle(url)
    const { html, text, ...rest } = r
    console.log(JSON.stringify(rest, null, 2))
    console.log('--- text (first 1200 chars) ---\n' + (text || '').slice(0, 1200))
    if (argv.includes('--html')) console.log('--- html ---\n' + html)
    await browser?.close()
    return
  }
  if (argv.includes('--once')) {
    const n = await pass()
    log('once: processed', n)
    await browser?.close()
    return
  }
  log('fetcher up; nyt session', fs.existsSync(NYT_STATE) ? 'present' : 'MISSING (nyt will fail as paywall)')
  for (;;) {
    try { await pass() } catch (e) { log('pass error', e.message) }
    // Recycle the browser between passes so a leaked page never grows forever.
    if (browser) { await browser.close().catch(() => {}); browser = null }
    await new Promise((r) => setTimeout(r, POLL))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
