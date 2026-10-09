/* Mirror of poller/press_poller.py canonicalize(): the dedupe key for a link
 * pasted in the app has to match the one the poller would have produced. */
const TRACKERS = new Set([
  'smid', 'rsrc', 'fbclid', 'gclid', 'igshid', 'igsh', 'si', 'ref', 'ref_src', 'ref_url', 'feature',
  'mc_cid', 'mc_eid', 'unlocked_article_code', 'campaign_id', 'emc', 'nl', 'te', 'referringsource',
  'sgrp', 'pvid', 'ck', 'ss', 'user_id', 'regi_id', 'uri', 'share', 'cmpid', 'ncid', 'source', 's', 't',
  'mibextid', 'mkt_tok', 'ito', 'ocid', 'cid', 'xid', 'via', 'srsltid', 'sfnsn', 'rbclickid', 'gift',
  'giftcopy', 'leadsource', 'wt.mc_id', 'searchresultposition', 'stkn', 'img_index', 'partner', 'sh', 'ref_',
])
const LINK_HOSTS = new Set([
  'youtube.com', 'youtu.be', 'open.spotify.com', 'x.com', 'twitter.com', 'instagram.com', 'tiktok.com',
  'podcasts.apple.com', 'music.apple.com', 'reddit.com', 'imgur.com', 'tenor.com', 'giphy.com',
  'apps.apple.com', 'maps.app.goo.gl', 'maps.google.com',
])

export function canonicalize(raw) {
  const u = new URL(raw.trim())
  let host = u.hostname.toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  if (host.startsWith('m.') && host.split('.').length >= 3) host = host.slice(2)
  const path = u.pathname.replace(/\/+$/, '') || '/'
  let keep = []
  for (const [k, v] of u.searchParams) {
    const kl = k.toLowerCase()
    if (TRACKERS.has(kl) || kl.startsWith('utm_')) continue
    keep.push([k, v])
  }
  if (host === 'youtube.com') keep = keep.filter(([k]) => k === 'v')
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const q = new URLSearchParams(keep).toString()
  return `https://${host}${path}${q ? '?' + q : ''}`
}

export const siteOf = (canon) => new URL(canon).hostname
export const kindOf = (site) => (LINK_HOSTS.has(site) ? 'link' : 'article')
