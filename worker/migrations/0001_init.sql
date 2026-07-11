-- Pixfix V2 — videos table (the gated library)
-- food_group uses the app's existing keys: make | learn | move | watch | wind
-- status: pending | approved | declined     added_by: child | parent | seed
CREATE TABLE IF NOT EXISTS videos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  yt_id        TEXT UNIQUE NOT NULL,
  title        TEXT,
  channel      TEXT,
  food_group   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  added_by     TEXT,
  added_at     INTEGER,
  approved_at  INTEGER,
  last_served  INTEGER,
  play_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_videos_status     ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_food_group ON videos(food_group);
CREATE INDEX IF NOT EXISTS idx_videos_channel    ON videos(channel);
