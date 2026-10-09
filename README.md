# Press

The Press Gang reading room. Every link dropped in the group chat lands in one
feed, cached as a clean article, with a Google-Docs-style margin to argue in.
Four people, each with their own login. Private.

## How it flows

```
iMessage group chat (chat.db on Nate's Mac)
  └─ poller/press_poller.py  (launchd, every 5 min, via the FDA-granted chatdb-dump binary)
       └─ Supabase project `jmpdqbabqrxkvwvxjzpu`: articles (pending) + shares
            └─ fetcher/fetch.mjs on the Beelink (Docker + Playwright, NYT session from storageState)
                 └─ articles (ready | link_only | failed) with sanitized HTML
                      └─ this app on GitHub Pages: feed, reader, comments
```

- **Only the Mac can read chat.db.** A closed laptop is a delay, not a loss:
  the poller keeps a ROWID watermark and catches up on wake.
- **NYT needs a session.** `fetcher/nyt-login.mjs` opens a real browser once,
  you sign in, it saves `fetcher/state/nyt-state.json`, you scp it to the
  Beelink. Until then NYT rows stay pending and untouched.
- **Comments anchor to text**, not DOM paths: quote plus 32 chars of context
  on each side, measured against the cached article. Cached text never
  changes, so anchors never rot.
- **People exist before they sign in.** The poller creates a placeholder
  profile per phone number it sees; `scripts/invite.mjs` names it and attaches
  the email. Sign-in is an emailed code, invite only.

## Repo map

| Path | What |
|---|---|
| `src/` | Vite + React PWA. `App.jsx` hash routes, `components/Feed.jsx`, `reader/Reader.jsx` + `reader/Rail.jsx`, `lib/anchor.js` for passage anchors, `lib/press.js` for every DB call. |
| `supabase/migrations/` | Schema, RLS, the auth trigger, the seed. Applied with `supabase db query --linked -f <file>`. |
| `poller/` | Mac side: `chatdb-dump.c`, `press_poller.py`, the launchd plist, `install.sh`. |
| `fetcher/` | Beelink side: `fetch.mjs` (queue loop), `extract.mjs` (runs in-page), Dockerfile, compose. |
| `scripts/` | `invite.mjs`, `dev-link.mjs` (one-shot sign-in link for local dev). |
| `DESIGN.md` | The look. Read it before touching CSS. |

## Running

```
cp .env.example .env            # fill in the anon key
npm install && npm run dev      # http://localhost:5173
node scripts/dev-link.mjs nates123@gmail.com http://localhost:5173   # sign in without email
```

Deploy = push to `main`; the workflow builds with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` from repo secrets and publishes to Pages. Bump
`VERSION` in `public/sw.js` on every ship.

### Mac poller

```
poller/install.sh               # copies script + plist, loads the agent
tail -f ~/.local/state/press-poller/poller.log
```

One-time: grant `~/Library/Application Support/press-poller/chatdb-dump` Full
Disk Access. Never rebuild that binary casually; a rebuild means granting again.

### Beelink fetcher

```
ssh nate@100.111.77.98
cd ~/apps/press-fetcher && docker compose up -d --build && docker logs -f press-fetcher
```

`press.env` holds the service key. `state/nyt-state.json` is the NYT session.
`docker compose run --rm press-fetcher node fetch.mjs --url <u>` renders one
link and prints what the reader would get, writing nothing.
