# Pixfix

A calm, finite media surface for kids — the opposite of a feed. Built with Gabriela.

Formerly *Warm Tubes*. One source (YouTube, gated), a curated library, a finite daily deck
that *ends*, and a choose-together ritual. No open search, no autoplay, no up-next.

## What's here

- `index.html` — the whole app (one self-contained file: HTML + CSS + JS, no build step)
- `worker/` — the Pixfix Worker: the gated library API on Cloudflare, backed by a D1 database
- `manifest.json` / `sw.js` — install to the iPad home screen as a full-screen offline-capable app
- `README.md` — this file

## Run it locally

Open `index.html` in a browser, or serve it (nicer for iPad testing on the same wifi):

```bash
python3 -m http.server 8080
# then visit http://localhost:8080  (or http://<your-mac-ip>:8080 from the iPad)
```

The Worker runs separately (`cd worker && npx wrangler dev`), but the app degrades gracefully:
if the Worker is unreachable it falls back to the last-synced library, then to the embedded seed.

## Put it on Gabriela's iPad

1. Open the deployed URL in Safari on her iPad.
2. Share → **Add to Home Screen** — it launches full-screen with its own icon.
3. For a locked session: triple-click the side button → **Guided Access** pins the iPad to Pixfix.

## The library — three layers

The app composes its library from three sources, deduped by video id (later layer wins):

1. **SEED** — a tiny embedded fallback in `index.html`. Survives reinstalls and offline cold starts.
2. **REMOTE (D1)** — the approved library served by the Worker at `GET /library`. **This is the
   live source of truth.** Cached to localStorage so an offline PWA still shows the last-known list.
3. **LIVE (`pf-lib`)** — a local override layer on the device (archive/retire state). No longer a
   write target for *adds* — see below.

### Adding videos

- **Share sheet (parent):** share a YouTube link to Pixfix with the parent token → auto-categorised
  into a food group and **approved** instantly (`POST /share`). Categorisation is one constrained
  Claude call that maps a title to one of the five groups — it never free-generates or recommends.
- **In-app add form (grown-up section):** posts **tokenless** → the video lands in the D1 **pending
  queue** for approval. No parent secret ever lives on the device. The approval back office lands in
  Step 4.

Each video is tagged by food group: `make · learn · move · watch · wind`.

## The daily deck

The home deck is governed by **rotation, not scarcity**:

- **Deck size N** — parent-configurable (default 5; stored locally now, settings UI in Step 4).
- **Rotation** — at most 2 consecutive plays from the same food group; then that group rests until
  another group is watched. Skips don't count as plays.
- **Watched = playback actually started.** Watched items leave the deck and appear on the Watch
  page's shelf (never deleted). A watch-again doesn't re-count or re-fill the rainbow.
- **Rainbow meter** — five day-scoped segments, one per food group, filled on watch. No points, no
  streaks, no loss; a sticker when all five fill. Shares the deck's day-set.
- **Closedown** — at N plays the day ends diegetically with a PIXFIX-VISION test-pattern card, not
  an abrupt stop. Quiet reset at local midnight.

Watched-state and the deck-size setting live in localStorage for now; both **graduate to D1 in
Step 4** alongside the back office, when a parent needs cross-device visibility of what she's watched.

## Roadmap

- **v1** — curated player, finite cards, choose-together. Shipped; lived with.
- **v2** — the gated Worker + D1 library, share-sheet capture, an approval queue, and the
  rotation-driven daily deck. *(current)*
- **v3** — the AI *librarian*: a constrained recommender that routes and sequences over the approved
  list only. Never a companion, never a free-generator.

## Notes

- Playback runs through YouTube's IFrame player (`playsinline=1`, `rel=0`) to keep everything inside
  one gated surface — no related videos, no channel surfing.
- The AI layer is deliberately minimal today (categorisation only). The recommender is v3, and only
  after v2 has run for a while.
