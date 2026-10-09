#!/usr/bin/env node
/**
 * One-time NYT login for the Beelink fetcher. Run on the Mac:
 *
 *   cd fetcher && npm install && npx playwright install chromium && node ../scripts/nyt-login.mjs
 *
 * Opens a real Chromium window on the NYT login page. Sign in, and as soon as
 * the NYT-S session cookie appears the script saves a Playwright storageState
 * to fetcher/state/nyt-state.json and prints the scp line that puts it on the
 * Beelink. The cookie is good for roughly a year; rerun this when the fetcher
 * starts logging "paywall".
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
const out = path.join(here, '../fetcher/state/nyt-state.json')
fs.mkdirSync(path.dirname(out), { recursive: true })

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] })
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  viewport: { width: 1200, height: 900 },
})
const page = await ctx.newPage()
await page.goto('https://myaccount.nytimes.com/auth/login')
console.log('Sign in to the NYT in the window. Waiting for the session cookie...')

for (;;) {
  const cookies = await ctx.cookies('https://www.nytimes.com')
  if (cookies.some((c) => c.name === 'NYT-S' && c.value.length > 20)) break
  await new Promise((r) => setTimeout(r, 1500))
}
// Let the post-login redirects settle so every cookie is in place.
await page.goto('https://www.nytimes.com/').catch(() => {})
await page.waitForTimeout(3000)
await ctx.storageState({ path: out })
fs.chmodSync(out, 0o600)
await browser.close()
console.log(`Saved ${out}`)
console.log('Now put it on the Beelink:')
console.log(`  ssh nate@100.111.77.98 'mkdir -p ~/apps/press-fetcher/state' && scp ${out} nate@100.111.77.98:~/apps/press-fetcher/state/nyt-state.json`)
console.log("  ssh nate@100.111.77.98 'cd ~/apps/press-fetcher && docker compose restart'")
