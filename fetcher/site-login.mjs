#!/usr/bin/env node
/**
 * Sign the Mac reader's Chrome profile in to a paywalled site, once.
 *
 *   cd ~/Developer/press/fetcher && node site-login.mjs https://www.wsj.com/
 *
 * Opens the REAL Google Chrome with the same profile the reader uses
 * (state/chrome-profile, see nytLocalPass in fetch.mjs), on the given site.
 * Sign in there, then close the window. The login lives in the profile, so
 * every later pass reads the site as a subscriber. NYT has its own
 * nyt-login.mjs; this is for everything else on the WALLED list.
 *
 * The reader shares this profile, and Chrome locks a profile while it is open.
 * Run this when nothing is fetching (Chrome not in the Dock), and close the
 * window when done or the reader skips its pass.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const url = process.argv[2]
if (!/^https?:\/\//.test(url || '')) { console.error('usage: node site-login.mjs https://www.wsj.com/'); process.exit(2) }

const here = path.dirname(fileURLToPath(import.meta.url))
const profile = path.join(here, 'state/chrome-profile')
if (!fs.existsSync(profile)) { console.error('no chrome profile at', profile, '- run nyt-login.mjs first'); process.exit(1) }

let ctx
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
  })
} catch (e) {
  console.error('Could not open Chrome on the reader profile (is the reader mid-pass? wait a minute):', e.message)
  process.exit(1)
}
const page = ctx.pages()[0] || (await ctx.newPage())
await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
console.log(`Chrome is open on ${url}. Sign in, then close the Chrome window.`)
// On macOS closing the last window leaves Chrome running, so the context never
// closes by itself and the profile stays locked. Finish when the last tab goes.
await new Promise((resolve) => {
  ctx.on('close', resolve)
  const check = () => { if (ctx.pages().length === 0) resolve() }
  const watch = (p) => p.on('close', () => setTimeout(check, 500))
  ctx.pages().forEach(watch)
  ctx.on('page', watch)
})
await ctx.close().catch(() => {})   // graceful: flushes the login cookies to disk
console.log('Saved. The reader now reads this site signed in.')
