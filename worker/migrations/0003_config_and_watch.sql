-- Pixfix V2 Step 4 — additive only, never touches the videos table.
--   config      : settings that must reach the child device (deck size N lives here
--                 so a parent dial on one device reaches her iPad).
--   watch_events: append-only watch log for parent visibility (Step 4d). Deck /
--                 rotation / rainbow keep reading the local day-set for speed; this
--                 is the long-term "what has she watched" record.
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO config (key, value) VALUES ('deck_n', '5');

CREATE TABLE IF NOT EXISTS watch_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  yt_id      TEXT NOT NULL,
  watched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_events_time ON watch_events(watched_at);
