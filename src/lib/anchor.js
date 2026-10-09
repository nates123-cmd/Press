/**
 * Passage anchors, W3C TextQuoteSelector style: the quoted text plus a little
 * context on either side, measured against the article's rendered text. The
 * cached HTML never changes after the fetch, so an anchor found once is found
 * forever. No DOM paths anywhere.
 */

const CONTEXT = 32

/* Every text node, no filtering: the offsets below are measured with
 * Range.toString(), which counts every text node too, so the two must agree. */
function* textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) yield n
}

/** Flat text of the body plus the node map used to go from offsets back to the DOM. */
export function indexText(root) {
  const nodes = []
  let text = ''
  for (const n of textNodes(root)) {
    nodes.push({ node: n, start: text.length, end: text.length + n.nodeValue.length })
    text += n.nodeValue
  }
  return { text, nodes }
}

/* Text offset of a boundary point: the length of everything from the start
 * of root up to it. Works whether the point is in a text node, an element
 * with no text (a figure), or the root itself. */
function offsetOf(root, node, offset) {
  const r = document.createRange()
  r.setStart(root, 0)
  try { r.setEnd(node, offset) } catch { return null }
  return r.toString().length
}

/** From a live Selection range inside root to a storable anchor. */
export function anchorFromRange(root, range) {
  const index = indexText(root)
  let a = offsetOf(root, range.startContainer, range.startOffset)
  let b = offsetOf(root, range.endContainer, range.endOffset)
  if (a == null || b == null) return null
  // Trim whitespace off both ends so a triple-click never anchors on the newline that follows.
  while (a < b && /\s/.test(index.text[a])) a++
  while (b > a && /\s/.test(index.text[b - 1])) b--
  if (b <= a) return null
  const quote = index.text.slice(a, b)
  if (!quote.trim()) return null
  return {
    quote,
    prefix: index.text.slice(Math.max(0, a - CONTEXT), a),
    suffix: index.text.slice(b, b + CONTEXT),
  }
}

/** Where an anchor sits in text, or -1. Prefers the occurrence whose context matches best. */
export function locate(text, { quote, prefix, suffix }) {
  if (!quote) return -1
  let best = -1, bestScore = -1
  let i = text.indexOf(quote)
  while (i !== -1) {
    let score = 0
    if (prefix) { const p = text.slice(Math.max(0, i - prefix.length), i); score += common(p, prefix, true) }
    if (suffix) { const s = text.slice(i + quote.length, i + quote.length + suffix.length); score += common(s, suffix, false) }
    if (score > bestScore) { best = i; bestScore = score }
    i = text.indexOf(quote, i + 1)
  }
  if (best !== -1) return best
  // Whitespace drift: retry on a collapsed copy and map back.
  const squash = (s) => s.replace(/\s+/g, ' ')
  const sq = squash(text), q = squash(quote).trim()
  const j = q ? sq.indexOf(q) : -1
  if (j === -1) return -1
  let k = 0, pos = 0
  while (k < text.length && pos < j) { pos += /\s/.test(text[k]) && /\s/.test(text[k + 1] || '') ? 0 : 1; k++ }
  return k
}

function common(a, b, fromEnd) {
  let n = 0
  if (fromEnd) { while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++ }
  else { while (n < a.length && n < b.length && a[n] === b[n]) n++ }
  return n
}

/**
 * Wrap [start, end) of the indexed text in <mark> elements, one per text node
 * touched. Returns the marks. Works across paragraphs because it never tries
 * to surround a range, only to split text nodes.
 */
export function markRange(root, start, end, attrs = {}) {
  const index = indexText(root)
  const marks = []
  for (const e of index.nodes) {
    if (e.end <= start || e.start >= end) continue
    const from = Math.max(start, e.start) - e.start
    const to = Math.min(end, e.end) - e.start
    let node = e.node
    if (from > 0) node = node.splitText(from)
    if (to - from < node.nodeValue.length) node.splitText(to - from)
    const mark = document.createElement('mark')
    for (const [k, v] of Object.entries(attrs)) mark.setAttribute(k, v)
    node.parentNode.insertBefore(mark, node)
    mark.appendChild(node)
    marks.push(mark)
  }
  return marks
}

/** Remove every mark we added, merging text nodes back together. */
export function clearMarks(root) {
  for (const m of Array.from(root.querySelectorAll('mark[data-cid]'))) {
    const parent = m.parentNode
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
  }
  root.normalize()
}
