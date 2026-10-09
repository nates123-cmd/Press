#!/usr/bin/env python3
"""
Press poller: the Mac half of the pipeline.

Reads the Press Gang group chat out of ~/Library/Messages/chat.db (through the
chatdb-dump binary, which is the thing that holds Full Disk Access), finds every
message with a link in it, and writes one `articles` row per link and one
`shares` row per (message, link) to the Press Supabase project. The Beelink
fetcher takes it from there.

Runs under launchd every five minutes, one pass per run (no loop). State is a
single watermark, the last chat.db message ROWID seen, so a closed laptop is a
delay and never a loss.

Files, all in ~/Library/Application Support/press-poller/:
  .env         SUPABASE_URL, SUPABASE_SERVICE_KEY, PRESS_CHAT_ROWID
  chatdb-dump  compiled from poller/chatdb-dump.c, granted Full Disk Access once
  state.json   {"last_rowid": N}

Flags: --dry (print, write nothing), --since-rowid N (ignore state once),
--reset (start from the beginning of the chat).

Only /usr/bin/python3 (3.9) is assumed. Stdlib only.
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

APP = os.path.expanduser('~/Library/Application Support/press-poller')
ENV_PATH = os.path.join(APP, '.env')
STATE_PATH = os.path.join(APP, 'state.json')
DUMP_BIN = os.path.join(APP, 'chatdb-dump')

URL_RE = re.compile(r'https?://[^\s<>"“”\'\)\]]+')
APPLE_EPOCH = 978307200  # 2001-01-01 in unix seconds

# Query params that identify the sharer, the campaign, or the gift, never the page.
TRACKER_PARAMS = {
    'smid', 'rsrc', 'fbclid', 'gclid', 'igshid', 'igsh', 'si', 'ref', 'ref_src', 'ref_url',
    'feature', 'mc_cid', 'mc_eid', 'unlocked_article_code', 'campaign_id', 'emc', 'nl', 'te',
    'referringsource', 'sgrp', 'pvid', 'ck', 'ss', 'user_id', 'regi_id', 'uri', 'share',
    'cmpid', 'ncid', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'utm_content', 'utm_id', 's', 't', 'mibextid', 'mkt_tok', 'ito', 'ocid', 'cid', 'xid',
    'via', 'srsltid', 'sfnsn', 'rbclickid', 'gift', 'giftcopy', 'leadsource', 'wt.mc_id',
    'searchresultposition', 'stkn', 'igshid', 'img_index', 'partner', 'sh', 'ref_',
}
# Hosts whose links are never articles: the fetcher gives them a title and a
# thumbnail and leaves them as link cards.
LINK_HOSTS = {
    'youtube.com', 'youtu.be', 'open.spotify.com', 'x.com', 'twitter.com', 'instagram.com',
    'tiktok.com', 'podcasts.apple.com', 'music.apple.com', 'reddit.com', 'imgur.com',
    'tenor.com', 'giphy.com', 'apps.apple.com', 'maps.app.goo.gl', 'maps.google.com',
}
PALETTE = ['#B5481A', '#3E6B35', '#7A3E8C', '#9A6B00', '#0B6E6E', '#8C2E4A']


def log(*a):
    print(datetime.now().strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    for k in ('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'PRESS_CHAT_ROWID'):
        if not env.get(k):
            sys.exit('missing %s in %s' % (k, ENV_PATH))
    return env


ENV = load_env()


def sb(method, path, body=None, prefer=None):
    """One Supabase REST call as the service role. Returns parsed JSON or None."""
    url = ENV['SUPABASE_URL'] + '/rest/v1/' + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('apikey', ENV['SUPABASE_SERVICE_KEY'])
    req.add_header('Authorization', 'Bearer ' + ENV['SUPABASE_SERVICE_KEY'])
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', prefer or 'return=representation')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf8', 'replace')[:300]
        raise RuntimeError('%s %s -> %s %s' % (method, path, e.code, detail))


# ----------------------------------------------------------------- chat.db

def decode_body(hx):
    """The plain text out of an NSAttributedString typedstream. macOS 26 leaves
    message.text NULL and puts the body here. The first NSString payload sits
    right after b'NSString' ... b'+' with a one, two or four byte length."""
    if not hx:
        return None
    b = bytes.fromhex(hx)
    i = b.find(b'NSString')
    if i < 0:
        return None
    j = b.find(b'+', i)
    if j < 0:
        return None
    j += 1
    n = b[j]
    j += 1
    if n == 0x81:
        n = int.from_bytes(b[j:j + 2], 'little')
        j += 2
    elif n == 0x82:
        n = int.from_bytes(b[j:j + 4], 'little')
        j += 4
    return b[j:j + n].decode('utf8', 'replace')


def apple_date(d):
    secs = d / 1e9 if d > 1e12 else float(d)
    return datetime.fromtimestamp(secs + APPLE_EPOCH, tz=timezone.utc)


def dump_messages(chat_rowid, since_rowid):
    out = subprocess.run([DUMP_BIN, str(chat_rowid), str(since_rowid), '100000'],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError('chatdb-dump failed: ' + out.stderr.strip())
    return [json.loads(line) for line in out.stdout.splitlines() if line.strip()]


# ----------------------------------------------------------------- urls

def canonicalize(url):
    """The dedupe key. Lower-case host without www, https, no fragment, no
    tracking params, no trailing slash. Never collapses to the bare origin:
    two different NYT paths stay two articles."""
    p = urllib.parse.urlsplit(url.strip())
    host = p.netloc.lower()
    if host.startswith('www.'):
        host = host[4:]
    if host.startswith('m.') and host.count('.') >= 2:
        host = host[2:]
    path = re.sub(r'/+$', '', p.path) or '/'
    keep = []
    for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
        kl = k.lower()
        if kl in TRACKER_PARAMS or kl.startswith('utm_'):
            continue
        keep.append((k, v))
    if host in ('youtube.com',):
        keep = [(k, v) for k, v in keep if k == 'v']
    query = urllib.parse.urlencode(sorted(keep))
    return urllib.parse.urlunsplit(('https', host, path, query, ''))


def site_of(canon):
    return urllib.parse.urlsplit(canon).netloc


def kind_of(site):
    return 'link' if site in LINK_HOSTS else 'article'


# ----------------------------------------------------------------- supabase

class Store:
    def __init__(self, dry):
        self.dry = dry
        self.profiles = sb('GET', 'profiles?select=id,imessage_handle,is_me,color')
        self.me = next((p['id'] for p in self.profiles if p['is_me']), None)
        if not self.me:
            sys.exit('no is_me profile; run the seed migration first')

    def profile_for(self, handle):
        for p in self.profiles:
            if p['imessage_handle'] == handle:
                return p['id']
        used = {p['color'] for p in self.profiles}
        color = next((c for c in PALETTE if c not in used), PALETTE[len(self.profiles) % len(PALETTE)])
        last4 = re.sub(r'\D', '', handle)[-4:] or handle
        row = {'display_name': 'Friend %s' % last4, 'short_name': last4,
               'color': color, 'imessage_handle': handle}
        log('new profile for handle ending', last4)
        if self.dry:
            fake = {'id': 'dry-' + last4, 'imessage_handle': handle, 'is_me': False, 'color': color}
            self.profiles.append(fake)
            return fake['id']
        created = sb('POST', 'profiles', row)[0]
        self.profiles.append(created)
        return created['id']

    def article_for(self, raw_url):
        canon = canonicalize(raw_url)
        q = 'articles?select=id,status&canonical_url=eq.' + urllib.parse.quote(canon, safe='')
        if self.dry:
            return {'id': 'dry', 'canonical_url': canon}, True
        found = sb('GET', q)
        if found:
            return found[0], False
        site = site_of(canon)
        row = {'canonical_url': canon, 'url': raw_url, 'site': site, 'kind': kind_of(site)}
        sb('POST', 'articles?on_conflict=canonical_url', row,
           prefer='resolution=ignore-duplicates,return=minimal')
        return sb('GET', q)[0], True

    def share(self, article_id, profile_id, rowid, raw_url, note, shared_at):
        row = {'article_id': article_id, 'profile_id': profile_id, 'message_rowid': rowid,
               'raw_url': raw_url, 'note': note, 'source': 'imessage',
               'shared_at': shared_at.isoformat()}
        if self.dry:
            return
        sb('POST', 'shares?on_conflict=message_rowid,article_id', row,
           prefer='resolution=ignore-duplicates,return=minimal')


# ----------------------------------------------------------------- main

def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'last_rowid': 0}


def save_state(state, dry):
    if dry:
        return
    tmp = STATE_PATH + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f)
    os.replace(tmp, STATE_PATH)


def main(argv):
    dry = '--dry' in argv
    state = load_state()
    if '--reset' in argv:
        state['last_rowid'] = 0
    if '--since-rowid' in argv:
        state['last_rowid'] = int(argv[argv.index('--since-rowid') + 1])

    rows = dump_messages(int(ENV['PRESS_CHAT_ROWID']), state['last_rowid'])
    if not rows:
        return
    store = Store(dry)
    n_links = n_new = 0
    for r in rows:
        try:
            if r.get('assoc', 0) == 0:
                text = r.get('text') or decode_body(r.get('body_hex')) or ''
                urls = [u for u in dict.fromkeys(URL_RE.findall(text)) if '…' not in u]
                if urls:
                    note = URL_RE.sub('', text).strip(' \n\t-:,') or None
                    who = store.me if r['from_me'] else store.profile_for(r['handle'] or '')
                    when = apple_date(r['date'])
                    for u in urls:
                        art, created = store.article_for(u)
                        store.share(art['id'], who, r['rowid'], u, note, when)
                        n_links += 1
                        n_new += int(created)
                        log('share', when.strftime('%m-%d'), 'me' if r['from_me'] else 'friend',
                            canonicalize(u)[:90], '(new)' if created else '')
            state['last_rowid'] = r['rowid']
            save_state(state, dry)
        except Exception as e:  # keep the watermark behind the failing row and stop
            log('error at rowid', r['rowid'], e)
            return 1
    log('pass done: %d messages, %d links, %d new articles, watermark %d'
        % (len(rows), n_links, n_new, state['last_rowid']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]) or 0)
