# Pixfix

A calm, finite media surface for kids — the opposite of a feed. Built with Gabriela.

Formerly *Warm Tubes*. This is **v1: the dumb curated player** — one source, a hand-curated
library, a finite set of daily cards that *ends*, and a choose-together ritual. No AI yet.
That comes at v3, and only once we've lived with this for a while.

## What's here

- `index.html` — the whole app (one self-contained file: HTML + CSS + JS, no build step)
- `manifest.json` — lets it install to the iPad home screen as a full-screen app
- `README.md` — this file

## Run it locally

Just open `index.html` in a browser. Or serve it (nicer for iPad testing on the same wifi):

```bash
python3 -m http.server 8080
# then visit http://localhost:8080  (or http://<your-mac-ip>:8080 from the iPad)
```

## Put it on Gabriela's iPad

1. Open the deployed URL in Safari on her iPad.
2. Share → **Add to Home Screen**.
3. It launches full-screen with its own icon — no Safari chrome.
4. For a locked session: triple-click the side button → **Guided Access** pins the iPad to Pixfix
   so she can't swipe out mid-session.

## The library

Curated items live in the `LIBRARY` array in `index.html`, each tagged by food group:
`make · learn · move · watch · wind`. `TODAY` picks which ones make up the finite daily deck.
Editing those two is the whole curation job for now.

## Roadmap (from the build outline)

- **v1** — this. Curated player, manual library, finite cards, three profiles, choose-together. Ship, live with it.
- **v2** — a shared "want to try" queue the girls fill; parent approves.
- **v3** — the AI *librarian* (constrained recommender over the whitelist, never a companion). Only now.

## Notes

- The AI layer, when it lands, routes and sequences from the approved list. It never free-generates.
- Music currently runs through simple tones; real playback goes through YouTube's IFrame
  player (`playsinline=1`, related off) to keep everything inside one gated surface.
