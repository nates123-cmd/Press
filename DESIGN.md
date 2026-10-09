# Press, the design contract

Press is a reading room for one group chat. Four people, mostly NYT, a margin
to argue in. It should feel like a well-set newspaper page with a Google Docs
comment rail bolted to the side, not like an app.

## References, each answering one question

1. **The printed NYT page** answers *what does reading feel like*. One serif
   doing headline and body at different optical sizes (Newsreader, variable
   `opsz`), tight headline leading, a one-line italic dek, hairline rules, tiny
   letter-spaced small caps for section and date. Paper, not white.
2. **Google Docs comments** answers *how do comments behave*. A right-hand
   rail of flat cards, each pinned to its highlight's vertical position,
   pushed down when they collide. One pale highlight colour for every passage,
   a stronger one for the active passage, the active card slides left by a few
   pixels. Reply, resolve, reopen. Resolved threads leave the page.
3. **Instapaper** answers *what is the feed*. A plain list separated by
   hairlines. No cards, no thumbnails competing with titles, the title is the
   whole row. Metadata is one quiet line.

Combine by assignment, never by averaging.

## Tokens

```
--paper        #F6F3EC   dark #15171A     page
--paper-2      #EFEBE1   dark #1C1F23     comment cards, sheets
--ink          #161512   dark #E8E4DA     body text, titles
--ink-2        #5B574F   dark #A39E93     deks, bylines
--ink-3        #8B867C   dark #7B766D     meta, timestamps, small caps
--rule         #D9D3C5   dark #2B2E33     every hairline
--accent       #C8102E   dark #E3453F     the masthead dot, unread marker, danger
--hl           #FBEFB1   dark #4A4420     passage highlight
--hl-active    #F4D96B   dark #7A6A22     active passage
--font-display 'Newsreader', Georgia, serif
--font-body    'Newsreader', Georgia, serif
--font-ui      'IBM Plex Sans', system-ui, sans-serif
--radius       2px
--shadow       none
```

Each person owns one marker ink, stored on `profiles.color`, used for the
initial circle, the share bar in the feed, and the border of their active
comment card. Four defaults: `#1F4E79` (Nate), `#B5481A`, `#3E6B35`, `#7A3E8C`.

## Type scale

Masthead 34/36 Newsreader 700. Feed title 22/26 Newsreader 500. Reader h1
40/44 on desktop, 30/34 on phone, Newsreader 600, `opsz` auto. Dek 20/28 italic
400. Body 19/31 Newsreader 400, max 680px measure. Body h2 24/30 600. Small
caps 12/16 Plex Sans 500, 0.08em tracking, uppercase. Comment body 14/21 Plex
Sans. Everything in the UI chrome is Plex Sans; everything that is the article
is Newsreader.

## Rules

- Rules, not boxes. A 1px `--rule` line separates things. Borders on comment
  cards only, radius 2px, no shadow anywhere.
- No icons where a word fits. "Reply", "Resolve", "Mark read" are words.
- No emoji, no unicode stars.
- Images: hotlinked, `max-width: 100%`, captions in Plex Sans `--ink-3`.
- Desktop at or above 1040px shows the reading column plus a 300px rail.
  Below that the rail disappears, highlights are tappable and open a bottom
  sheet, and the comment affordance is a pill above the selection.
- Dark mode inverts paper and ink with the values above. Highlights stay
  yellow-brown, never blue.
- Every visual change is rendered and looked at before it ships. Reasoning
  about a design is not seeing it.

## Banned

System font stack. Gradients. Rounded cards everywhere. One `--muted` doing
three jobs. Avatar photos. Toast notifications. Skeleton shimmer. A hamburger.
