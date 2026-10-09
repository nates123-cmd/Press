/**
 * Everything that runs INSIDE the page. Serialized into page.evaluate, so no
 * imports, no closures over Node state. Readability is injected separately
 * (fetch.mjs adds node_modules/@mozilla/readability/Readability.js as a
 * script tag) and is reached as window.Readability.
 *
 * Output shape, same for every site:
 *   { title, byline, dek, publishedAt, heroImage, heroCaption, html, text, wordCount, method }
 *
 * `html` is already sanitized to the reader's allowlist. `text` is the same
 * content as plain text with paragraph breaks; comment anchors are measured
 * against the rendered DOM, not this, so it only has to be close.
 */

export function pageExtract({ host }) {
  const meta = (sel) => {
    const el = document.querySelector(sel)
    return el ? (el.getAttribute('content') || '').trim() : ''
  }
  const metaAny = (...sels) => sels.map(meta).find(Boolean) || ''

  // ---------------------------------------------------------------- sanitize
  const ALLOW = {
    p: [], h2: [], h3: [], h4: [], blockquote: [], figure: [], figcaption: [],
    ul: [], ol: [], li: [], em: [], strong: [], i: [], b: [], br: [], hr: [],
    pre: [], code: [], sup: [], sub: [], a: ['href'], img: ['src', 'alt', 'width', 'height'],
  }
  const UNWRAP = new Set(['div', 'section', 'article', 'span', 'main', 'header', 'footer', 'font', 'center', 'u'])
  const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'svg', 'button', 'form', 'input', 'nav', 'aside', 'video', 'audio', 'template', 'select', 'label'])
  const DROP_SELECTORS = [
    '[data-testid="inline-message"]', '[data-testid*="newsletter"]', '[data-testid="share-tools"]',
    '[role="complementary"]', '.ad', '[id^="story-ad"]', '[class*="newsletter"]', '[class*="related"]',
    '[class*="promo"]', '[class*="recirc"]', '[aria-hidden="true"]:not(img)', '[data-testid="photoviewer-children-figure-caption"]',
  ]

  const bestSrc = (img) => {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset')
    if (srcset) {
      // Never split on commas: CDN urls (Substack, Cloudinary) carry commas inside the path.
      const cands = Array.from(srcset.matchAll(/(\S+)\s+(\d+(?:\.\d+)?)[wx](?:\s*,|\s*$)/g)).map((m) => [m[1], parseFloat(m[2])])
      cands.sort((a, b) => b[1] - a[1])
      if (cands[0] && /^(https?:)?\/\//.test(cands[0][0])) return cands[0][0]
    }
    return img.getAttribute('src') || img.getAttribute('data-src') || ''
  }

  const sanitizeInto = (src, out) => {
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) { out.appendChild(document.createTextNode(node.nodeValue)); continue }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const tag = node.tagName.toLowerCase()
      if (DROP.has(tag)) continue
      if (tag === 'picture') {
        const img = node.querySelector('img')
        if (img) { const i = document.createElement('img'); i.setAttribute('src', bestSrc(img)); if (img.alt) i.setAttribute('alt', img.alt); out.appendChild(i) }
        continue
      }
      if (ALLOW[tag]) {
        const el = document.createElement(tag)
        for (const attr of ALLOW[tag]) {
          let v = tag === 'img' && attr === 'src' ? bestSrc(node) : node.getAttribute(attr)
          if (!v) continue
          if (attr === 'href' || attr === 'src') {
            try { v = new URL(v, location.href).href } catch { continue }
            if (!/^https?:/.test(v)) continue
          }
          el.setAttribute(attr, v)
        }
        if (tag === 'a') { el.setAttribute('rel', 'noopener'); el.setAttribute('target', '_blank') }
        sanitizeInto(node, el)
        if (tag === 'img' || tag === 'br' || tag === 'hr' || el.textContent.trim() || el.querySelector('img')) out.appendChild(el)
        continue
      }
      // unknown or wrapper tag: hoist children
      if (UNWRAP.has(tag) || true) sanitizeInto(node, out)
    }
  }

  const finish = (container) => {
    // Loose text directly in the root becomes paragraphs; empty blocks go.
    const root = document.createElement('div')
    let para = null
    for (const node of Array.from(container.childNodes)) {
      const inline = node.nodeType === Node.TEXT_NODE || ['a', 'em', 'strong', 'i', 'b', 'code', 'sup', 'sub', 'br'].includes(node.tagName?.toLowerCase())
      if (inline) {
        if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim() && !para) continue
        if (!para) { para = document.createElement('p'); root.appendChild(para) }
        para.appendChild(node)
      } else { para = null; root.appendChild(node) }
    }
    for (const p of Array.from(root.querySelectorAll('p, h2, h3, h4, li, blockquote, figcaption'))) {
      if (!p.textContent.trim() && !p.querySelector('img')) p.remove()
    }
    for (const f of Array.from(root.querySelectorAll('figure'))) if (!f.querySelector('img')) f.remove()
    // Dedupe: the same image as hero and as first figure.
    const text = Array.from(root.children).map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')
    return { html: root.innerHTML, text, wordCount: text ? text.split(/\s+/).length : 0 }
  }

  const sanitize = (sourceEl) => {
    const clone = sourceEl.cloneNode(true)
    for (const sel of DROP_SELECTORS) for (const el of Array.from(clone.querySelectorAll(sel))) el.remove()
    const out = document.createElement('div')
    sanitizeInto(clone, out)
    return finish(out)
  }

  const common = () => ({
    title: metaAny('meta[property="og:title"]', 'meta[name="twitter:title"]') || document.title || '',
    dek: metaAny('meta[property="og:description"]', 'meta[name="description"]'),
    publishedAt: metaAny('meta[property="article:published_time"]', 'meta[name="pubdate"]', 'meta[name="date"]', 'meta[itemprop="datePublished"]') || null,
    heroImage: metaAny('meta[property="og:image"]', 'meta[name="twitter:image"]') || null,
    byline: metaAny('meta[name="byl"]', 'meta[name="author"]', 'meta[property="article:author"]'),
    siteName: metaAny('meta[property="og:site_name"]'),
  })

  // ---------------------------------------------------------------- NYT
  const nyt = () => {
    const body = document.querySelector('section[name="articleBody"]')
    const gate = document.querySelector('#gateway-content, [data-testid="gateway-container"], [id^="gateway"]')
    if (!body || body.textContent.trim().length < 400) {
      return { error: gate ? 'paywall: no NYT session in the fetcher' : 'nyt: no articleBody' }
    }
    const c = common()
    const h1 = document.querySelector('h1[data-testid="headline"], h1')
    const dekEl = document.querySelector('p#article-summary, [data-testid="article-summary"], p.css-summary')
    const heroFig = document.querySelector('header figure, [data-testid="photoviewer-wrapper"], figure[aria-label="media"]')
    const heroCap = heroFig?.querySelector('figcaption')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    const { html, text, wordCount } = sanitize(body)
    return {
      ...c,
      title: h1?.textContent?.trim() || c.title,
      dek: dekEl?.textContent?.trim() || c.dek,
      byline: (c.byline || document.querySelector('[data-testid="byline"] span, p.byline, [itemprop="author"]')?.textContent || '').replace(/^By\s+/i, '').trim(),
      heroCaption: heroCap,
      html, text, wordCount, method: 'nyt',
    }
  }

  // ---------------------------------------------------------------- generic
  const generic = () => {
    const c = common()
    if (!window.Readability) return { error: 'readability not injected' }
    const doc = document.cloneNode(true)
    // Site chrome that Readability keeps because it is dense with text.
    const PRE_DROP = ['.infobox', '.navbox', '.vertical-navbox', '.sidebar', '.mw-editsection', '.hatnote', '.reflist',
      '.mw-jump-link', '#toc', '.toc', '.metadata', '.ambox', '.shortdescription', '.mw-empty-elt', '.noprint',
      '.subscription-widget-wrap', '.subscribe-widget', '.button-wrapper', '.pencraft.pc-display-flex',
      '[class*="paywall"]', '[class*="subscribe"]', '[id*="newsletter"]', '.share-dialog', '[data-component="newsletter"]']
    for (const sel of PRE_DROP) for (const el of Array.from(doc.querySelectorAll(sel))) el.remove()
    const art = new window.Readability(doc, { keepClasses: false }).parse()
    if (!art || !art.content) return { error: 'readability: nothing parsed' }
    const holder = document.createElement('div')
    holder.innerHTML = art.content
    const { html, text, wordCount } = sanitize(holder)
    return {
      ...c,
      title: art.title || c.title,
      byline: (art.byline || c.byline || '').replace(/^By\s+/i, '').trim(),
      dek: c.dek || art.excerpt || '',
      heroCaption: '',
      html, text, wordCount, method: 'readability',
    }
  }

  // ---------------------------------------------------------------- link card
  const card = () => ({ ...common(), html: '', text: '', wordCount: 0, heroCaption: '', method: 'card' })

  try {
    if (host === 'nytimes.com') {
      const r = nyt()
      if (!r.error) return r
      if (/paywall/.test(r.error)) return r
      const g = generic()
      return g.error ? r : g
    }
    return generic()
  } catch (e) {
    return { error: 'extract threw: ' + (e && e.message) }
  }
  // unreachable, kept for symmetry with the card path used by fetch.mjs
  // eslint-disable-next-line no-unreachable
  return card()
}

/** Metas only, for hosts that are never articles. Also runs in-page. */
export function pageCard() {
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || ''
  const any = (...s) => s.map(meta).find(Boolean) || ''
  return {
    title: any('meta[property="og:title"]', 'meta[name="twitter:title"]') || document.title || '',
    dek: any('meta[property="og:description"]', 'meta[name="description"]'),
    heroImage: any('meta[property="og:image"]', 'meta[name="twitter:image"]') || null,
    byline: any('meta[property="og:site_name"]', 'meta[name="author"]'),
    publishedAt: any('meta[property="article:published_time"]') || null,
    html: '', text: '', wordCount: 0, heroCaption: '', method: 'card',
  }
}
