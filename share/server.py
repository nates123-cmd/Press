"""Link previews for Press share links.

press.nsteph.com/s/<token> exists so iMessage, WhatsApp, Slack and the rest
show the article (photo, headline, dek) instead of the generic Press card. The
app itself routes on the #hash, which link-preview fetchers never send, so the
GitHub Pages URL can only ever preview as the home page.

Preview fetchers get a small HTML page of Open Graph tags. People get a 302 to
the real page on GitHub Pages. Everything comes from the anon-callable
press_public_article(token), the same thing the public page reads: article
text fields only, nothing about the group.

Stdlib only. Runs on the Beelink behind Caddy (~/apps/press-share).
"""
import html
import json
import os
import re
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
ANON_KEY = os.environ['SUPABASE_ANON_KEY']
APP_URL = os.environ.get('APP_URL', 'https://nates123-cmd.github.io/Press/').rstrip('/') + '/'
FALLBACK_IMAGE = APP_URL + 'icon-512.png'

TOKEN_RE = re.compile(r'^/s/([A-Za-z0-9_-]{16,64})/?$')
# iMessage's fetcher announces itself as facebookexternalhit + Twitterbot.
BOT_RE = re.compile(r'facebookexternalhit|facebot|twitterbot|slackbot|discordbot|whatsapp|telegrambot|'
                    r'linkedinbot|skypeuripreview|googlebot|bingbot|embedly|pinterest|redditbot|'
                    r'applebot|iframely|bot\b|crawler|spider|preview', re.I)

_cache = {}   # token -> (expires, row)
TTL = 300


def article(token):
    hit = _cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/rpc/press_public_article',
        data=json.dumps({'p_token': token}).encode(),
        headers={'apikey': ANON_KEY, 'Authorization': f'Bearer {ANON_KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=8) as r:
        rows = json.loads(r.read() or '[]')
    row = rows[0] if rows else None
    _cache[token] = (time.time() + TTL, row)
    if len(_cache) > 2000:
        _cache.clear()
    return row


def page(token, a):
    e = lambda s: html.escape(s or '', quote=True)
    title = a.get('title') or a.get('url') or 'Press Gang'
    dek = a.get('dek') or ''
    site = a.get('site') or ''
    image = a.get('hero_image_url') or FALLBACK_IMAGE
    target = f'{APP_URL}#/s/{token}'
    byline = f"By {a['byline']}" if a.get('byline') else ''
    desc = dek or byline or f'From {site}, shared from Press Gang.'
    return f'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(target)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{e(site + ' · Press Gang' if site else 'Press Gang')}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{e(image)}">
<meta property="og:url" content="https://{e(os.environ.get('PUBLIC_HOST', 'press.nsteph.com'))}/s/{e(token)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{e(image)}">
</head><body>
<p><a href="{e(target)}">{e(title)}</a></p>
</body></html>'''


class Handler(BaseHTTPRequestHandler):
    server_version = 'press-share'

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        m = TOKEN_RE.match(self.path.split('?', 1)[0])
        if not m:
            return self.send(302, b'', {'Location': APP_URL})
        token = m.group(1)
        if not BOT_RE.search(self.headers.get('User-Agent', '')):
            return self.send(302, b'', {'Location': f'{APP_URL}#/s/{token}', 'Cache-Control': 'no-store'})
        try:
            a = article(token)
        except Exception as ex:  # Supabase down: the app link still works
            self.log_error('lookup failed: %s', ex)
            a = None
        if not a:
            return self.send(302, b'', {'Location': APP_URL})
        body = page(token, a).encode()
        self.send(200, b'' if head else body, {'Content-Type': 'text/html; charset=utf-8',
                                               'Cache-Control': 'public, max-age=300',
                                               'Content-Length': str(len(body))})

    def send(self, code, body, headers):
        self.send_response(code)
        for k, v in headers.items():
            self.send_header(k, v)
        if 'Content-Length' not in headers:
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        print('%s %s' % (self.headers.get('User-Agent', '-')[:60] if hasattr(self, 'headers') and self.headers else '-',
                         fmt % args), flush=True)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
