#!/usr/bin/env node
/**
 * One-time NYT login for the Beelink fetcher. Run on the Mac:
 *
 *   cd fetcher && npm install && node nyt-login.mjs
 *
 * Drives the REAL Google Chrome installed on this Mac (not Playwright's
 * bundled Chromium, which NYT's bot wall fingerprints and blocks) with its own
 * persistent profile under state/chrome-profile. Sign in on nytimes.com in
 * that window. As soon as the NYT-S session cookie appears the script saves a
 * Playwright storageState to state/nyt-state.json, records the browser's
 * user-agent next to it (the bot wall ties cookies to the UA), and prints the
 * scp line that puts both on the Beelink. Rerun when the fetcher logs
 * "paywall" or "bot block".
 *
 * Why not copy a Chrome profile: Chromium encrypts cookies with the macOS
 * Keychain, so a profile directory does not decrypt on Linux. storageState is
 * plain JSON and works anywhere. Treat it like a password (chmod 600).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const stateDir = path.join(here, 'state')
const out = path.join(stateDir, 'nyt-state.json')
const uaOut = path.join(stateDir, 'nyt-ua.txt')
const profile = path.join(stateDir, 'chrome-profile')
fs.mkdirSync(profile, { recursive: true })

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
  console.error('Could not start Google Chrome (is it installed in /Applications?):', e.message)
  process.exit(1)
}
const page = ctx.pages()[0] || (await ctx.newPage())
await page.goto('https://www.nytimes.com/', { waitUntil: 'domcontentloaded' }).catch(() => {})
console.log('Chrome is open on nytimes.com. Use "Log in" at the top right and sign in. Waiting for the session cookie...')

for (;;) {
  const cookies = await ctx.cookies('https://www.nytimes.com')
  if (cookies.some((c) => c.name === 'NYT-S' && c.value.length > 20)) break
  await new Promise((r) => setTimeout(r, 1500))
}
// Let the post-login redirects settle so every cookie, including the bot wall's, is in place.
await page.waitForTimeout(4000)
await page.goto('https://www.nytimes.com/section/todayspaper', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(2500)
const ua = await page.evaluate(() => navigator.userAgent)
await ctx.storageState({ path: out })
fs.writeFileSync(uaOut, ua + '\n')
fs.chmodSync(out, 0o600)
await ctx.close()
console.log(`Saved ${out}`)
console.log('Now put it on the Beelink and restart the fetcher:')
console.log(`  ssh nate@100.111.77.98 'mkdir -p ~/apps/press-fetcher/state' && scp ${out} ${uaOut} nate@100.111.77.98:~/apps/press-fetcher/state/`)
console.log("  ssh nate@100.111.77.98 'cd ~/apps/press-fetcher && docker compose restart'")
