# Press, the design contract

Press is a reading room for one group chat. It should read like the paper
itself: the New York Times section front for the feed, a New Yorker article
page for the reader, and the Times' comment panel for the arguing. Not an app.

## References, each answering one question

1. **The NYT section front** answers *what is the feed*. Bold Cheltenham-style
   headlines, one grey summary line in the text face, a byline in Franklin
   small caps, a thumbnail on the right, hairlines between stories. The
   masthead is blackletter, centred, with the date line under it and the
   Times' thick-then-thin double rule.
2. **A New Yorker article page** answers *what does reading feel like*.
   Centred kicker in letter-spaced small caps, a big Caslon headline, an
   italic dek, the byline in small caps, a hairline, then the picture. Body in
   Caslon at a generous size with a three-line drop cap on the first
   paragraph. White paper, black ink, nothing tinted.
3. **The NYT comment panel** answers *how do comments behave*. A panel slides
   in from the right over the page, white, with a hairline on its left edge.
   "Comments 14" and a close at the top, a composer under that, then the
   thread list, newest first. Each comment: name bold in Franklin, time in
   grey, body in Franklin, "Reply" in the Times blue. Replies indent under
   their parent behind a "3 replies" toggle. Press adds the passage: a comment
   anchored to text shows its quote on top, clicking it jumps to the highlight,
   clicking the highlight opens the panel on that comment.

Combine by assignment, never by averaging.

## Tokens

```
--paper        #FFFFFF   dark #121212     page
--paper-2      #F7F7F7   dark #1A1A1A     panel composer, feed thumbs
--ink          #121212   dark #ECECEC     body text, titles
--ink-2        #363636   dark #BDBDBD     summaries, deks
--ink-3        #727272   dark #8A8A8A     meta, timestamps, small caps
--rule         #E2E2E2   dark #2E2E2E     hairlines
--rule-strong  #121212   dark #ECECEC     the masthead double rule
--accent       #326891   dark #6FA3C8     links, Reply, the comments button
--hl           #FFF4B8   dark #4A4420     passage highlight
--hl-active    #FFE86B   dark #7A6A22     active passage
--font-masthead 'UnifrakturMaguntia', serif
--font-display  'Libre Caslon Display', 'Libre Caslon Text', Georgia, serif
--font-body     'Libre Caslon Text', Georgia, serif
--font-ui       'Libre Franklin', 'Helvetica Neue', Arial, sans-serif
--radius        0
--shadow        none
```

Each person owns one marker ink, stored on `profiles.color`, used for the
initial circle and the active comment's left bar. Four defaults: `#1F4E79`
(Nate), `#B5481A`, `#3E6B35`, `#7A3E8C`.

## Type scale

Masthead 44 blackletter, centred. Feed headline 20/24 Caslon Display 700.
Feed summary 16/22 Caslon Text `--ink-2`. Reader kicker 12/16 Franklin 600,
0.14em tracking, uppercase, centred. Reader headline 44/48 Caslon Display 700
on desktop, 32/36 on phone, centred, max 14 words wide. Dek 21/30 Caslon
italic `--ink-2`, centred. Byline 12/16 Franklin 600 small caps. Body 20/32
Caslon Text, measure 640px. Drop cap 3 lines, Caslon Display. Body h2 24/30
Caslon Display 700. Captions 12/17 Franklin `--ink-3`. Panel comment body
15/22 Franklin. Everything in the chrome is Franklin, everything that is the
article is Caslon.

## Rules

- White. No cream, no tint, no gradient. Dark mode is near-black and
  off-white with the same structure.
- Rules, not boxes. Hairlines separate; nothing has a border radius; nothing
  has a shadow except the panel's single left hairline.
- The panel is 420px wide on desktop, the full width on phone, slides in over
  the page, scrolls on its own, closes with the X, the scrim, or Escape.
- Links and actions are `--accent` blue, underlined only in body text.
- No icons where a word fits, except the comment bubble on the button.
- No emoji, no unicode stars, no avatars beyond an initial in a circle.
- Images hotlinked, full column width, captions under them.
- Every visual change is rendered and looked at before it ships.

## Banned

System font stack. Rounded cards. Shadows. Toasts. Skeleton shimmer. A
hamburger. Colour anywhere the Times would not put it.
